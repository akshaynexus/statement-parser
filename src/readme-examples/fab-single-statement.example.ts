import {parsePdfs, ParserType} from '..';

parsePdfs([
    {
        parserInput: {
            filePath: 'path/to/your/fab-statement.pdf',
            name: 'FAB Statement - January 2024',
            parserOptions: {
                yearPrefix: 20, // For years 2000-2099
            },
        },
        type: ParserType.FabBank,
    },
]).then((results) => {
    const statement = results[0];
    if (statement) {
        console.log('Customer:', statement.data.name);
        console.log('Account Suffix:', statement.data.accountSuffix);
        console.log('Income Transactions:', statement.data.incomes.length);
        console.log('Expense Transactions:', statement.data.expenses.length);

        // Calculate totals
        const totalIncome = statement.data.incomes.reduce((sum, tx) => sum + tx.amount, 0);
        const totalExpenses = statement.data.expenses.reduce(
            (sum, tx) => sum + Math.abs(tx.amount),
            0,
        );

        console.log('Total Income: AED', totalIncome.toFixed(2));
        console.log('Total Expenses: AED', totalExpenses.toFixed(2));
        console.log('Net Amount: AED', (totalIncome - totalExpenses).toFixed(2));
    }
});
