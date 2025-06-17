import {createDateFromUtcIsoFormat, safeMatch, removeCommasFromNumberString} from 'augment-vir';
import {ParsedOutput, ParsedTransaction} from '../parsed-output';
import {createStatementParser} from '../statement-parser';
import {CombineWithBaseParserOptions} from '../parser-options';

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
    ],
});

// Regular expressions for different transaction patterns
const statementPeriodRegExp = /Account Statement FROM (\d{2} \w{3} \d{4}) TO (\d{2} \w{3} \d{4})/;
const accountNumberRegExp = /AC-NUM (\d{3}-\d{3}-\d{7}-\d{2}-\d)/;
const customerNameRegExp = /^([A-Z ]+?)\s+AC-NUM/;

function parseDate(dateString: string): Date | undefined {
    try {
        // Convert "01 APR 2025" to ISO format "2025-04-01"
        const months: {[key: string]: string} = {
            'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
            'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
            'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
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

function parseTransaction(line: string): ParsedTransaction | undefined {
    // Clean up the line by removing extra spaces
    const cleanLine = line.replace(/\s+/g, ' ').trim();
    
    // Skip non-transaction lines
    if (!cleanLine.match(/^\d{2} \w{3} \d{4}/)) {
        return undefined;
    }
    
    // Pattern 1: Regular transactions - DATE VALUE_DATE DESCRIPTION AMOUNT BALANCE
    const regularMatch = cleanLine.match(/^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/);
    
    if (regularMatch) {
        const [, dateStr, , description, amountStr, balanceStr] = regularMatch;
        
        if (dateStr && description && amountStr && balanceStr) {
            const date = parseDate(dateStr);
            
            if (date) {
                const amount = parseFloat(removeCommasFromNumberString(amountStr));
                const desc = description.trim();
                
                // Determine if it's income or expense based on transaction type
                let finalAmount = amount;
                
                // Income transaction types (positive amounts)
                if (desc.toLowerCase().includes('transfer') || 
                    desc.toLowerCase().includes('inward') || 
                    desc.toLowerCase().includes('deposit') ||
                    desc.toLowerCase().includes('reverse charges') ||
                    desc.toLowerCase().includes('atm cash deposit') ||
                    desc.toLowerCase().includes('cash deposit')) {
                    finalAmount = Math.abs(amount); // Ensure positive for income
                } else {
                    // Expense transactions (negative amounts)
                    finalAmount = -Math.abs(amount); // Ensure negative for expenses
                }
            
                return {
                    date,
                    description: desc,
                    amount: finalAmount,
                    originalText: [line],
                };
            }
        }
    }
    
    // Pattern 2: Special income transactions like ATM Cash Deposit
    // Format: DATE VALUE_DATE DESCRIPTION_WITH_AMOUNT FINAL_BALANCE
    const depositMatch = cleanLine.match(/^(\d{2} \w{3} \d{4})\s+(\d{2} \w{3} \d{4})\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/);
    
    if (depositMatch) {
        const [, dateStr, , fullDesc, possibleAmount, balanceStr] = depositMatch;
        
        if (dateStr && fullDesc && balanceStr) {
            // Look for amount pattern in description (like "18,000.00 59,341.62")
            const amountInDesc = fullDesc.match(/([\d,]+\.?\d*)/);
            
            if (amountInDesc && amountInDesc[1]) {
                const date = parseDate(dateStr);
                
                if (date) {
                    const amount = parseFloat(removeCommasFromNumberString(amountInDesc[1]));
                    const desc = fullDesc.replace(/\s+[\d,]+\.?\d*.*$/, '').trim(); // Remove amount from description
                    
                                    // If it's clearly a deposit/income transaction
                if (desc.toLowerCase().includes('deposit') ||
                    desc.toLowerCase().includes('transfer') ||
                    desc.toLowerCase().includes('inward') ||
                    desc.toLowerCase().includes('cash deposit')) {
                        
                        return {
                            date,
                            description: desc,
                            amount: Math.abs(amount), // Positive for income
                            originalText: [line],
                        };
                    }
                }
            }
        }
    }
    
    return undefined;
}

function extractAccountInfo(line: string, output: ParsedOutput): void {
    // Try regular match for account number and customer name
    const accountMatch = line.match(accountNumberRegExp);
    if (accountMatch && accountMatch[1]) {
        // Extract last segment after the last dash: "190-100-5675760-00-2" -> "2"
        const accountParts = accountMatch[1].split('-');
        output.accountSuffix = accountParts[accountParts.length - 1] || '';
        
        // Extract customer name from the same line
        const nameMatch = line.match(customerNameRegExp);
        if (nameMatch && nameMatch[1]) {
            output.name = nameMatch[1].trim();
        }
    }
    
    // Try regular match for statement period
    const periodMatch = line.match(statementPeriodRegExp);
    if (periodMatch && periodMatch[1] && periodMatch[2]) {
        output.startDate = parseDate(periodMatch[1]);
        output.endDate = parseDate(periodMatch[2]);
        
        // Set year prefix based on start date
        if (output.startDate) {
            output.yearPrefix = Math.floor(output.startDate.getFullYear() / 100);
        }
    }
}

function performStateAction(
    currentState: State, 
    line: string, 
    output: ParsedOutput,
    parserOptions: CombineWithBaseParserOptions<undefined>
): ParsedOutput {
    const cleanLine = line.trim();
    
    // Extract account information in all states
    extractAccountInfo(cleanLine, output);
    
    // Set year prefix from parser options if not already set
    if (!output.yearPrefix) {
        output.yearPrefix = parserOptions.yearPrefix;
    }
    
    // Parse transactions in the transaction lines state
    if (currentState === State.TransactionLines) {
        // Skip header lines and balance forward lines
        if (cleanLine.includes('DATE VALUE DATE DESCRIPTION') || 
            cleanLine.includes('Balance carried forward') ||
            cleanLine.includes('Balance brought forward') ||
            cleanLine.startsWith('Sheet no.') ||
            cleanLine.includes('Important:') ||
            cleanLine.length < 10) {
            return output;
        }
        
        const transaction = parseTransaction(cleanLine);
        
        if (transaction) {
            // Categorize as income or expense based on amount
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
    parserOptions: CombineWithBaseParserOptions<undefined>
): State {
    const cleanLine = line.toLowerCase().trim();
    
    switch (currentState) {
        case State.Header:
            // Start parsing transactions when we see the transaction header
            if (cleanLine.includes('date value date description debit credit balance')) {
                return State.TransactionLines;
            }
            break;
            
        case State.TransactionLines:
            // Continue parsing until we reach the end of the statement
            if (cleanLine.includes('closing book balance') || 
                cleanLine.includes('end of statement') ||
                cleanLine.includes('total debit txns') ||
                (cleanLine.includes('total') && cleanLine.includes('txns'))) {
                return State.End;
            }
            break;
            
        case State.End:
            // Stay in end state
            break;
    }
    
    return currentState;
} 