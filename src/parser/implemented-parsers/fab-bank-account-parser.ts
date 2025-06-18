import {createDateFromUtcIsoFormat, removeCommasFromNumberString} from 'augment-vir';
import {ParsedOutput, ParsedTransaction} from '../parsed-output';
import {CombineWithBaseParserOptions} from '../parser-options';
import {createStatementParser} from '../statement-parser';

enum State {
    Header = 'header',
    TransactionLines = 'transaction-lines',
    End = 'end',
}

export const fabBankAccountParser = createStatementParser<State, ParsedOutput>({
    action: performStateAction,
    next: nextState,
    initialState: State.Header,
    endState: State.End,
    parserKeywords: [
        'POS Settlement',
        'Transfer',
        'Inward IPP Payment',
        'Switch Transaction',
        'SW WDL Chgs',
        'Reverse Charges',
        'VAT',
        'Balance carried forward',
        'Balance brought forward',
        'Opening balance',
        'Closing Book Balance',
        'ATM Cash Deposit',
        'Cash Deposit',
    ],
});

// Regular expressions for different transaction patterns
const statementPeriodRegExp = /Account Statement FROM (\d{2} \w{3} \d{4}) TO (\d{2} \w{3} \d{4})/;
const accountNumberRegExp = /AC-NUM (\d{3}-\d{3}-\d{7}-\d{2}-\d)/;
const customerNameRegExp = /^([A-Z ]+?)\s+AC-NUM/;

function parseDate(dateString: string): Date | undefined {
    try {
        const months: {[key: string]: string} = {
            JAN: '01',
            FEB: '02',
            MAR: '03',
            APR: '04',
            MAY: '05',
            JUN: '06',
            JUL: '07',
            AUG: '08',
            SEP: '09',
            OCT: '10',
            NOV: '11',
            DEC: '12',
        };

        const parts = dateString.split(' ');
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
            const day = parts[0].padStart(2, '0');
            const month = months[parts[1]];
            const year = parts[2];

            if (month) {
                return createDateFromUtcIsoFormat(`${year}-${month}-${day}`);
            }
        }
        return undefined;
    } catch {
        return undefined;
    }
}

function parseAmount(amountStr: string): number {
    return parseFloat(removeCommasFromNumberString(amountStr));
}

function isIncomeTransaction(description: string): boolean {
    const incomeKeywords = [
        'transfer',
        'inward',
        'deposit',
        'reverse charges',
        'atm cash deposit',
        'cash deposit',
        'credit',
    ];

    const lowerDesc = description.toLowerCase();
    return incomeKeywords.some((keyword) => lowerDesc.includes(keyword));
}

function parseTransactionLine(line: string): ParsedTransaction | undefined {
    const cleanLine = line.replace(/\s+/g, ' ').trim();

    // Skip empty lines and irrelevant content
    if (!cleanLine || 
        cleanLine.includes('Balance carried forward') ||
        cleanLine.includes('Balance brought forward') ||
        cleanLine.includes('Important:') ||
        cleanLine.includes('T&Cs Apply') ||
        cleanLine.includes('First Abu Dhabi Bank') ||
        cleanLine.includes('Contact Centre') ||
        cleanLine.includes('endeavor to get back') ||
        cleanLine.match(/^[\u0600-\u06FF\s]+$/) || // Arabic text
        cleanLine.includes('DATE VALUE DATE DESCRIPTION') ||
        cleanLine.startsWith('Sheet no.') ||
        cleanLine.match(/^\d+$/) || // Standalone numbers
        cleanLine.includes('Closing Book Balance') ||
        cleanLine.includes('Closing Statement Balance') ||
        cleanLine.includes('Total Debit Txns') ||
        cleanLine.includes('Tot. Debit Amnt') ||
        cleanLine.includes('Total Credit Txns') ||
        cleanLine.includes('Tot. Credit Amnt') ||
        cleanLine.includes('Debit Interest') ||
        cleanLine.includes('Opening balance') ||
        cleanLine.match(/^ACCOUNT STATEMENT$/i) ||
        cleanLine.match(/^Currency AED$/i) ||
        cleanLine.includes('PO Box') ||
        cleanLine.includes('Dubai Creek') ||
        cleanLine.includes('Dubai,ARE') ||
        cleanLine.match(/^\d{6}$/) // 6-digit numbers like postal codes
    ) {
        return undefined;
    }

    // Main transaction pattern: DATE VALUE_DATE DESCRIPTION AMOUNT BALANCE
    // Example: "17 APR 2025 15 APR 2025 POS Settlement WWW.GRAB.COM BANGKOK THB 81.57 63,049.27"
    const transactionPattern = /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/;
    const match = cleanLine.match(transactionPattern);
    
    if (match && match[1] && match[3] && match[4] && match[5]) {
        const transactionDate = parseDate(match[1]);
        const description = match[3].trim();
        const amount = parseAmount(match[4]);
        const balance = parseAmount(match[5]);
        
        if (!transactionDate || !description || isNaN(amount) || isNaN(balance)) {
            return undefined;
        }

        // Determine if this is income or expense
        const isIncome = isIncomeTransaction(description);
        const finalAmount = isIncome ? Math.abs(amount) : -Math.abs(amount);

        return {
            date: transactionDate,
            description: description,
            amount: finalAmount,
            originalText: [cleanLine],
        };
    }

    // Alternative pattern for transactions that might not have the exact format
    // Look for lines with dates and amounts that might be transactions
    const datePattern = /^(\d{2} \w{3} \d{4})/;
    const hasDate = datePattern.test(cleanLine);
    const hasAmount = /[\d,]+\.?\d+/.test(cleanLine);
    const hasTransactionKeywords = /POS Settlement|Transfer|Payment|ATM|Deposit|Withdrawal|Charges|VAT|Switch|Reverse|Inward|Outward/i.test(cleanLine);
    
    if (hasDate && hasAmount && hasTransactionKeywords) {
        // Try to extract what we can
        const dateMatch = cleanLine.match(datePattern);
        if (dateMatch && dateMatch[1]) {
            const transactionDate = parseDate(dateMatch[1]);
            if (transactionDate) {
                // Extract the last number as balance, second-to-last as amount
                const numbers = cleanLine.match(/[\d,]+\.?\d*/g) || [];
                if (numbers.length >= 2) {
                    const amountStr = numbers[numbers.length - 2];
                    const balanceStr = numbers[numbers.length - 1];
                    
                    if (!amountStr || !balanceStr) return undefined;
                    
                    const amount = parseAmount(amountStr);
                    const balance = parseAmount(balanceStr);
                    
                    // Extract description by removing dates and numbers
                    let description = cleanLine
                        .replace(/^\d{2} \w{3} \d{4}\s*/, '') // Remove first date
                        .replace(/\d{2} \w{3} \d{4}\s*/, '') // Remove second date if exists
                        .replace(/[\d,]+\.?\d*\s*$/, '') // Remove balance at end
                        .replace(/[\d,]+\.?\d*\s*$/, '') // Remove amount at end
                        .trim();
                    
                    if (description && !isNaN(amount) && !isNaN(balance)) {
                        const isIncome = isIncomeTransaction(description);
                        const finalAmount = isIncome ? Math.abs(amount) : -Math.abs(amount);

                        return {
                            date: transactionDate,
                            description: description,
                            amount: finalAmount,
                            originalText: [cleanLine],
                        };
                    }
                }
            }
        }
    }

    return undefined;
}

function extractAccountInfo(line: string, output: ParsedOutput): void {
    const accountMatch = line.match(accountNumberRegExp);
    if (accountMatch && accountMatch[1]) {
        const accountParts = accountMatch[1].split('-');
        output.accountSuffix = accountParts[accountParts.length - 1] || '';

        const nameMatch = line.match(customerNameRegExp);
        if (nameMatch && nameMatch[1]) {
            output.name = nameMatch[1].trim();
        }
    }

    const periodMatch = line.match(statementPeriodRegExp);
    if (periodMatch && periodMatch[1] && periodMatch[2]) {
        const startDate = parseDate(periodMatch[1]);
        const endDate = parseDate(periodMatch[2]);
        
        if (startDate) {
            output.startDate = startDate;
            output.yearPrefix = Math.floor(startDate.getFullYear() / 100);
        }
        
        if (endDate) {
            output.endDate = endDate;
        }
    }
}

function performStateAction(
    currentState: State,
    line: string,
    output: ParsedOutput,
    parserOptions: CombineWithBaseParserOptions<undefined>,
): ParsedOutput {
    const cleanLine = line.trim();

    // Extract account information in all states
    extractAccountInfo(cleanLine, output);

    if (!output.yearPrefix) {
        output.yearPrefix = parserOptions.yearPrefix;
    }

    if (currentState === State.TransactionLines) {
        const transaction = parseTransactionLine(cleanLine);

        if (transaction) {
            if (transaction.amount > 0) {
                output.incomes.push(transaction);
            } else {
                output.expenses.push(transaction);
            }
        }
    }

    return output;
}

function nextState(
    currentState: State,
    line: string,
    parserOptions: CombineWithBaseParserOptions<undefined>,
): State {
    const cleanLine = line.toLowerCase().trim();

    switch (currentState) {
        case State.Header:
            // Start parsing transactions after we see the table header
            if (cleanLine.includes('date value date description debit credit balance') ||
                (cleanLine.includes('balance') && (cleanLine.includes('opening') || cleanLine.includes('brought forward')))) {
                return State.TransactionLines;
            }
            break;

        case State.TransactionLines:
            if (
                cleanLine.includes('closing book balance') ||
                cleanLine.includes('closing statement balance') ||
                cleanLine.includes('end of statement') ||
                cleanLine.includes('total debit txns') ||
                (cleanLine.includes('total') && cleanLine.includes('txns'))
            ) {
                return State.End;
            }
            break;

        case State.End:
            break;
    }

    return currentState;
}

