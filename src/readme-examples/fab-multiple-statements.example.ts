import {parsePdfs, ParserType} from '..';

const fabStatements = [
    'path/to/fab-january-2024.pdf',
    'path/to/fab-february-2024.pdf',
    'path/to/fab-march-2024.pdf',
];

parsePdfs(
    fabStatements.map((filePath) => ({
        parserInput: {
            filePath,
            parserOptions: {
                yearPrefix: 20,
            },
        },
        type: ParserType.FabBank,
    })),
).then((results) => {
    let totalIncome = 0;
    let totalExpenses = 0;

    results.forEach((result) => {
        const income = result.data.incomes.reduce((sum, tx) => sum + tx.amount, 0);
        const expenses = result.data.expenses.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

        totalIncome += income;
        totalExpenses += expenses;

        console.log(
            `${result.data.name}: Income AED ${income.toFixed(2)}, Expenses AED ${expenses.toFixed(
                2,
            )}`,
        );
    });

    console.log(`\nTotal across all statements:`);
    console.log(`Income: AED ${totalIncome.toFixed(2)}`);
    console.log(`Expenses: AED ${totalExpenses.toFixed(2)}`);
    console.log(`Net: AED ${(totalIncome - totalExpenses).toFixed(2)}`);
});
