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

// Enhanced transaction parsing patterns
const transactionPatterns = [
    // Pattern 1: Standard format - DATE VALUE_DATE DESCRIPTION AMOUNT BALANCE
    /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/,

    // Pattern 2: With currency - DATE VALUE_DATE DESCRIPTION CURRENCY AMOUNT BALANCE
    /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+[A-Z]{3}\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/,

    // Pattern 3: Description with embedded amount - DATE VALUE_DATE DESCRIPTION_WITH_AMOUNT BALANCE
    /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/,

    // Pattern 4: VAT transactions - DATE VALUE_DATE POS Settlement VAT AED AMOUNT BALANCE
    /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(POS Settlement VAT AED)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/,

    // Pattern 5: Switch/ATM transactions - DATE VALUE_DATE TYPE AMOUNT BALANCE
    /^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(Switch Transaction|SW WDL Chgs|ATM Cash Deposit)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/,
];

// Store incomplete transactions across multiple lines
let pendingTransaction: Partial<ParsedTransaction> | null = null;

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

function parseTransaction(line: string): ParsedTransaction | undefined {
    const cleanLine = line.replace(/\s+/g, ' ').trim();

    // Handle continuation lines first (before checking for date pattern)
    if (!cleanLine.match(/^\d{2} \w{3} \d{4}/) && pendingTransaction) {
        // This is a continuation line - append to pending transaction
        if (pendingTransaction.description) {
            pendingTransaction.description += ' ' + cleanLine;
        }

        // Try to complete the transaction now that we have more description
        completePendingTransaction();

        return undefined;
    }

    // If we have a pending transaction and we're starting a new date line, complete the previous one
    if (pendingTransaction && cleanLine.match(/^\d{2} \w{3} \d{4}/)) {
        const completed = completePendingTransaction();

        // Now process the current line as a new transaction
        const newTransaction = parseNewTransaction(cleanLine, line);
        if (newTransaction) {
            if (newTransaction.amount !== undefined) {
                // Complete transaction
                return completed;
            } else {
                // Incomplete transaction - store as pending
                pendingTransaction = newTransaction;
                return completed;
            }
        }

        return completed;
    }

    // Skip non-transaction lines that don't start with a date
    if (!cleanLine.match(/^\d{2} \w{3} \d{4}/)) {
        return undefined;
    }

    // Process new transaction
    const newTransaction = parseNewTransaction(cleanLine, line);
    if (newTransaction) {
        // Check if this is a complete transaction or needs continuation
        if (newTransaction.amount !== undefined) {
            // Complete transaction
            return newTransaction;
        } else {
            // Incomplete transaction - store as pending
            pendingTransaction = newTransaction;
            return undefined;
        }
    }

    return undefined;
}

function completePendingTransaction(): ParsedTransaction | undefined {
    if (!pendingTransaction || !pendingTransaction.description) {
        return undefined;
    }

    // Extract amount and balance from the full description
    const description = pendingTransaction.description;

    // Look for amount and balance pattern in the full description
    // Pattern: "description amount balance" where balance is at the end
    const balanceMatch = description.match(/([\d,]+\.?\d*)\s*$/);

    if (balanceMatch && balanceMatch[1]) {
        // Found balance at the end
        const balance = parseAmount(balanceMatch[1]);

        // Now look for the amount (should be the second-to-last number)
        const beforeBalance = description.substring(0, description.lastIndexOf(balanceMatch[1]));
        const amountMatch = beforeBalance.match(/([\d,]+\.?\d*)\s*$/);

        if (amountMatch && amountMatch[1]) {
            const amount = parseAmount(amountMatch[1]);

            // Complete the transaction
            let finalAmount = amount;
            if (isIncomeTransaction(description)) {
                finalAmount = Math.abs(amount);
            } else {
                finalAmount = -Math.abs(amount);
            }

            const completed: ParsedTransaction = {
                date: pendingTransaction.date!,
                description: description.trim(),
                amount: finalAmount,
                originalText: pendingTransaction.originalText || [],
            };

            pendingTransaction = null;
            return completed;
        }
    }

    return undefined;
}

function parseNewTransaction(
    cleanLine: string,
    originalLine: string,
): ParsedTransaction | undefined {
    // Try each transaction pattern
    for (let i = 0; i < transactionPatterns.length; i++) {
        const pattern = transactionPatterns[i];
        if (!pattern) continue;

        const match = cleanLine.match(pattern);

        if (match) {
            let dateStr: string | undefined,
                description: string | undefined,
                amountStr: string | undefined,
                balanceStr: string | undefined;

            if (i === 3) {
                // VAT pattern
                dateStr = match[1];
                description = match[3];
                amountStr = match[4];
                balanceStr = match[6];
            } else if (i === 4) {
                // Switch/ATM pattern
                dateStr = match[1];
                description = match[3];
                amountStr = match[4];
                balanceStr = match[5];
            } else {
                // Standard patterns
                dateStr = match[1];
                description = match[3];
                amountStr = match[4];
                balanceStr = match[5];
            }

            if (dateStr && description && amountStr && balanceStr) {
                const date = parseDate(dateStr);

                if (date) {
                    const amount = parseAmount(amountStr);
                    const desc = description.trim();

                    // Determine if it's income or expense
                    let finalAmount = amount;
                    if (isIncomeTransaction(desc)) {
                        finalAmount = Math.abs(amount); // Positive for income
                    } else {
                        finalAmount = -Math.abs(amount); // Negative for expenses
                    }

                    return {
                        date,
                        description: desc,
                        amount: finalAmount,
                        originalText: [originalLine],
                    };
                }
            }
        }
    }

    // Check if this is a transaction line that's missing amount/balance (incomplete)
    const incompleteMatch = cleanLine.match(/^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+)$/);
    if (incompleteMatch) {
        const dateStr = incompleteMatch[1];
        const description = incompleteMatch[3];

        if (dateStr && description) {
            const date = parseDate(dateStr);

            if (date) {
                // Create incomplete transaction (will be completed later)
                return {
                    date,
                    description: description.trim(),
                    originalText: [originalLine],
                } as ParsedTransaction;
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
        output.startDate = parseDate(periodMatch[1]);
        output.endDate = parseDate(periodMatch[2]);

        if (output.startDate) {
            output.yearPrefix = Math.floor(output.startDate.getFullYear() / 100);
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
        // Skip header lines and balance forward lines
        if (
            cleanLine.includes('DATE VALUE DATE DESCRIPTION') ||
            cleanLine.includes('Balance carried forward') ||
            cleanLine.includes('Balance brought forward') ||
            cleanLine.startsWith('Sheet no.') ||
            cleanLine.includes('Important:') ||
            cleanLine.includes('T&Cs Apply') ||
            cleanLine.includes('First Abu Dhabi Bank') ||
            cleanLine.includes('Contact Centre') ||
            cleanLine.includes('endeavor to get back') ||
            cleanLine.match(/^[\u0600-\u06FF\s]+$/) || // Arabic text
            cleanLine.length < 5 ||
            cleanLine.match(/^\d+$/) // Standalone numbers
        ) {
            return output;
        }

        const transaction = parseTransaction(cleanLine);

        if (transaction) {
            if (transaction.amount > 0) {
                output.incomes.push(transaction);
            } else {
                output.expenses.push(transaction);
            }
        }
    }

    // Complete any pending transaction when leaving TransactionLines state
    if (currentState === State.End && pendingTransaction) {
        // Try to complete the pending transaction by extracting amount from description
        if (pendingTransaction.description && !pendingTransaction.amount) {
            const amountMatch = pendingTransaction.description.match(/([\d,]+\.?\d*)/);
            if (amountMatch && amountMatch[1]) {
                const amount = parseAmount(amountMatch[1]);
                if (isIncomeTransaction(pendingTransaction.description)) {
                    pendingTransaction.amount = Math.abs(amount);
                } else {
                    pendingTransaction.amount = -Math.abs(amount);
                }
            }
        }

        // Add the completed transaction
        if (pendingTransaction.amount !== undefined) {
            if (pendingTransaction.amount > 0) {
                output.incomes.push(pendingTransaction as ParsedTransaction);
            } else {
                output.expenses.push(pendingTransaction as ParsedTransaction);
            }
        }

        pendingTransaction = null;
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
            if (cleanLine.includes('date value date description debit credit balance')) {
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
