import {testGroup} from 'test-vir';
import {fabBankAccountParser} from './fab-bank-account-parser';

const mockFabStatementText = [
    'First Abu Dhabi Bank PJSC | PO Box 6316 Abu Dhabi | United Arab Emirates',
    '',
    'ACCOUNT STATEMENT',
    'Currency AED',
    'JOHN DOE SMITH                                            AC-NUM 123-456-7890123-45-6',
    'PO Box 12345 Address Street No 123                       IBAN AE-12-345-123-456-7890123-45-6',
    'Dubai Marina Dubai',
    'Dubai,ARE                                     Account Statement FROM 01 JAN 2024 TO 31 JAN 2024',
    '',
    'Sheet no. 1',
    '',
    'DATE VALUE DATE DESCRIPTION DEBIT CREDIT BALANCE',
    '',
    'Balance brought forward 10,000.00',
    '',
    '01 JAN 2024 01 JAN 2024 POS Settlement GROCERY STORE DUBAI AED 150 150.00 9,850.00',
    '02 JAN 2024 02 JAN 2024 ATM Cash Deposit P32-1234 - CDM- Dubai Mall 5,000.00 14,850.00',
    '03 JAN 2024 03 JAN 2024 Transfer From Salary Account 3,500.00 18,350.00',
    '05 JAN 2024 05 JAN 2024 Switch Transaction 1,000.00 17,350.00',
    '05 JAN 2024 05 JAN 2024 SW WDL Chgs 21.00 17,329.00',
    '10 JAN 2024 10 JAN 2024 POS Settlement VAT AED 0.75 0.75 17,328.25',
    '15 JAN 2024 15 JAN 2024 Inward IPP Payment International Transfer 2,000.00 19,328.25',
    '20 JAN 2024 20 JAN 2024 POS Settlement RESTAURANT DUBAI AED 250 250.00 19,078.25',
    '25 JAN 2024 25 JAN 2024 Reverse Charges Refund 50.00 19,128.25',
    '30 JAN 2024 30 JAN 2024 POS Settlement ONLINE SHOPPING USD 100 367.30 18,760.95',
    '',
    'Closing Book Balance 18,760.95',
    '',
    '*** END OF STATEMENT ***'
];

testGroup({
    description: 'FAB Bank Account Parser',
    tests: (runTest) => {
        runTest({
            description: 'extracts account information correctly',
            test: async () => {
                const result = await fabBankAccountParser.parseText({
                    textLines: mockFabStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                return {
                    accountSuffix: result.accountSuffix,
                    customerName: result.name,
                    startDate: result.startDate?.toISOString(),
                    endDate: result.endDate?.toISOString(),
                    yearPrefix: result.yearPrefix,
                };
            },
            expect: {
                accountSuffix: '6',
                customerName: 'JOHN DOE SMITH',
                startDate: '2024-01-01T00:00:00.000Z',
                endDate: '2024-01-31T00:00:00.000Z',
                yearPrefix: 20,
            },
        });

        runTest({
            description: 'categorizes income transactions correctly',
            test: async () => {
                const result = await fabBankAccountParser.parseText({
                    textLines: mockFabStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                return result.incomes.map(income => ({
                    description: income.description,
                    amount: income.amount,
                    date: income.date.toISOString().split('T')[0], // Just the date part
                }));
            },
            expect: [
                {
                    description: 'ATM Cash Deposit P32-1234 - CDM- Dubai Mall',
                    amount: 5000,
                    date: '2024-01-02',
                },
                {
                    description: 'Transfer From Salary Account',
                    amount: 3500,
                    date: '2024-01-03',
                },
                {
                    description: 'Inward IPP Payment International Transfer',
                    amount: 2000,
                    date: '2024-01-15',
                },
                {
                    description: 'Reverse Charges Refund',
                    amount: 50,
                    date: '2024-01-25',
                },
            ],
        });

        runTest({
            description: 'categorizes expense transactions correctly',
            test: async () => {
                const result = await fabBankAccountParser.parseText({
                    textLines: mockFabStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                const expenses = result.expenses.map(expense => ({
                    description: expense.description,
                    amount: expense.amount,
                    date: expense.date.toISOString().split('T')[0],
                }));

                // Sort by date for consistent testing
                return expenses.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            },
            expect: [
                {
                    description: 'POS Settlement GROCERY STORE DUBAI AED 150',
                    amount: -150,
                    date: '2024-01-01',
                },
                {
                    description: 'Switch Transaction',
                    amount: -1000,
                    date: '2024-01-05',
                },
                {
                    description: 'SW WDL Chgs',
                    amount: -21,
                    date: '2024-01-05',
                },
                {
                    description: 'POS Settlement VAT AED 0.75',
                    amount: -0.75,
                    date: '2024-01-10',
                },
                {
                    description: 'POS Settlement RESTAURANT DUBAI AED 250',
                    amount: -250,
                    date: '2024-01-20',
                },
                {
                    description: 'POS Settlement ONLINE SHOPPING USD 100',
                    amount: -367.3,
                    date: '2024-01-30',
                },
            ],
        });

        runTest({
            description: 'handles ATM transactions correctly',
            test: async () => {
                const result = await fabBankAccountParser.parseText({
                    textLines: mockFabStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                const atmWithdrawals = result.expenses.filter(expense => 
                    expense.description.includes('Switch Transaction')
                );
                const atmCharges = result.expenses.filter(expense => 
                    expense.description.includes('SW WDL Chgs')
                );
                const atmDeposits = result.incomes.filter(income => 
                    income.description.includes('ATM Cash Deposit')
                );

                return {
                    withdrawalCount: atmWithdrawals.length,
                    withdrawalAmount: atmWithdrawals.reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
                    chargeCount: atmCharges.length,
                    chargeAmount: atmCharges.reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
                    depositCount: atmDeposits.length,
                    depositAmount: atmDeposits.reduce((sum, tx) => sum + tx.amount, 0),
                };
            },
            expect: {
                withdrawalCount: 1,
                withdrawalAmount: 1000,
                chargeCount: 1,
                chargeAmount: 21,
                depositCount: 1,
                depositAmount: 5000,
            },
        });

        runTest({
            description: 'calculates correct transaction totals',
            test: async () => {
                const result = await fabBankAccountParser.parseText({
                    textLines: mockFabStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                const totalIncome = result.incomes.reduce((sum, tx) => sum + tx.amount, 0);
                const totalExpenses = result.expenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

                return {
                    totalTransactions: result.incomes.length + result.expenses.length,
                    incomeCount: result.incomes.length,
                    expenseCount: result.expenses.length,
                    totalIncome: parseFloat(totalIncome.toFixed(2)),
                    totalExpenses: parseFloat(totalExpenses.toFixed(2)),
                    netAmount: parseFloat((totalIncome - totalExpenses).toFixed(2)),
                };
            },
            expect: {
                totalTransactions: 10,
                incomeCount: 4,
                expenseCount: 6,
                totalIncome: 10550,
                totalExpenses: 1789.05,
                netAmount: 8760.95,
            },
        });

        runTest({
            description: 'handles different customer names dynamically',
            test: async () => {
                const customStatementText = [...mockFabStatementText];
                // Replace the customer name line
                customStatementText[4] = 'SARAH JENNIFER BROWN WILSON                               AC-NUM 987-654-3210987-65-4';
                
                const result = await fabBankAccountParser.parseText({
                    textLines: customStatementText,
                    parserOptions: undefined,
                    debug: false,
                    name: 'test-statement',
                });

                return {
                    customerName: result.name,
                    accountSuffix: result.accountSuffix,
                };
            },
            expect: {
                customerName: 'SARAH JENNIFER BROWN WILSON',
                accountSuffix: '4',
            },
        });
    },
}); 