# FAB Bank Statement Parser Examples

This directory contains examples for using the FAB (First Abu Dhabi Bank) statement parser with the `statement-parser-fab` library.

## Installation

```bash
npm install statement-parser-fab
```

## Basic Usage

### Parse a Single FAB Statement

```typescript
import {parsePdfs, ParserType} from 'statement-parser-fab';

async function parseFabStatement() {
    const results = await parsePdfs([
        {
            parserInput: {
                filePath: 'path/to/your/fab-statement.pdf',
                name: 'FAB Statement - January 2024',
                debug: false, // Set to true for detailed parsing output
                parserOptions: {
                    yearPrefix: 20, // For years 2000-2099
                },
            },
            type: ParserType.FabBank,
        },
    ]);

    const statement = results[0];
    console.log('Customer:', statement.data.name);
    console.log('Account Suffix:', statement.data.accountSuffix);
    console.log('Income Transactions:', statement.data.incomes.length);
    console.log('Expense Transactions:', statement.data.expenses.length);

    return statement;
}
```

### Parse Multiple FAB Statements

```typescript
import {parsePdfs, ParserType} from 'statement-parser-fab';
import * as fs from 'fs';
import * as path from 'path';

async function parseMultipleFabStatements() {
    // Get all PDF files from a directory
    const statementsDir = 'path/to/your/statements/';
    const files = fs
        .readdirSync(statementsDir)
        .filter((file) => file.endsWith('.pdf'))
        .map((file) => path.join(statementsDir, file));

    // Prepare parsing inputs
    const parseInputs = files.map((filePath) => ({
        parserInput: {
            filePath,
            name: `FAB Statement - ${path.basename(filePath)}`,
            parserOptions: {yearPrefix: 20},
        },
        type: ParserType.FabBank,
    }));

    // Parse all statements
    const results = await parsePdfs(parseInputs);

    // Calculate totals across all statements
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

    return results;
}
```

## Direct Parser Usage

You can also use the FAB parser directly without the high-level API:

```typescript
import {parsers, ParserType} from 'statement-parser-fab';

async function directFabParsing() {
    const fabParser = parsers[ParserType.FabBank];

    // Parse from PDF file
    const result = await fabParser.parsePdf({
        filePath: 'path/to/fab-statement.pdf',
        parserOptions: {yearPrefix: 20},
    });

    // Or parse from text lines directly
    const textLines = [
        'line1',
        'line2',
        '...',
    ]; // Your statement text
    const resultFromText = await fabParser.parseText({
        textLines,
        parserOptions: {yearPrefix: 20},
        name: 'My Statement',
    });

    return result;
}
```

## Understanding the Output

The FAB parser returns a `ParsedOutput` object with the following structure:

```typescript
{
    name: string,              // Customer name (extracted dynamically)
    accountSuffix: string,     // Last digit of account number
    yearPrefix: number,        // Year prefix used for parsing
    startDate: Date,           // Statement start date
    endDate: Date,             // Statement end date
    incomes: Transaction[],    // Income transactions (deposits, transfers, etc.)
    expenses: Transaction[],   // Expense transactions (purchases, withdrawals, etc.)
}
```

Each transaction has:

```typescript
{
    date: Date,               // Transaction date
    amount: number,           // Amount (positive for income, negative for expenses)
    description: string,      // Transaction description
    originalText: string[],   // Original text lines from PDF
}
```

## Supported Transaction Types

The FAB parser recognizes these transaction types:

### Income Transactions:

-   **ATM Cash Deposit** - Cash deposits at ATMs
-   **Transfer** - Incoming transfers (salary, etc.)
-   **Inward IPP Payment** - International incoming payments
-   **Reverse Charges** - Refunds and charge reversals

### Expense Transactions:

-   **POS Settlement** - Point of sale purchases
-   **Switch Transaction** - ATM withdrawals
-   **SW WDL Chgs** - ATM withdrawal charges
-   **VAT** - Value added tax charges

## Error Handling

```typescript
import {parsePdfs, ParserType} from 'statement-parser-fab';

async function parseWithErrorHandling() {
    try {
        const results = await parsePdfs([
            {
                parserInput: {
                    filePath: 'path/to/fab-statement.pdf',
                },
                type: ParserType.FabBank,
            },
        ]);

        return results;
    } catch (error) {
        console.error('Failed to parse FAB statement:', error);

        // Handle specific error types
        if (error.message.includes('file not found')) {
            console.error('PDF file does not exist');
        } else if (error.message.includes('parsing failed')) {
            console.error('Statement format not recognized');
        }

        throw error;
    }
}
```

## Configuration Options

### Parser Options

```typescript
{
    parserOptions: {
        yearPrefix: 20,  // For years 2000-2099 (default: 20)
                        // Use 19 for years 1900-1999
    }
}
```

### Debug Mode

Enable debug mode to see detailed parsing output:

```typescript
{
    parserInput: {
        filePath: 'path/to/statement.pdf',
        debug: true,  // Shows state machine transitions
    },
    type: ParserType.FabBank,
}
```

## Common Use Cases

### 1. Monthly Statement Processing

```typescript
// Process statements for each month
const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
];
const results = await parsePdfs(
    months.map((month) => ({
        parserInput: {
            filePath: `statements/fab-${month}-2024.pdf`,
            name: `FAB ${month.toUpperCase()} 2024`,
        },
        type: ParserType.FabBank,
    })),
);
```

### 2. Transaction Analysis

```typescript
// Analyze spending patterns
const result = await parsePdfs([
    {
        /* ... */
    },
]);
const statement = result[0].data;

// Group expenses by type
const expensesByType = {};
statement.expenses.forEach((expense) => {
    const type = expense.description.split(' ')[0]; // First word
    expensesByType[type] = (expensesByType[type] || 0) + Math.abs(expense.amount);
});

console.log('Spending by category:', expensesByType);
```

### 3. Date Range Filtering

```typescript
// Filter transactions by date range
const statement = result[0].data;
const startDate = new Date('2024-01-01');
const endDate = new Date('2024-01-31');

const filteredTransactions = [
    ...statement.incomes,
    ...statement.expenses,
].filter((tx) => tx.date >= startDate && tx.date <= endDate);
```

## Notes

-   The FAB parser works with PDF statements from First Abu Dhabi Bank
-   Customer names are extracted dynamically from the statement
-   All amounts are in AED (Arab Emirates Dirham)
-   The parser handles multi-line transactions and various FAB transaction formats
-   Dates are parsed in "DD MMM YYYY" format (e.g., "01 APR 2025")

## Troubleshooting

### Common Issues:

1. **"Could not parse account number"** - Check if the PDF contains the standard FAB account number format
2. **"No transactions found"** - Verify the PDF is a valid FAB statement with transaction data
3. **"Date parsing failed"** - Ensure the yearPrefix option matches your statement's year range
4. **"Customer name not found"** - The statement might have a non-standard format

### Getting Help:

-   Enable debug mode to see detailed parsing output
-   Check that your PDF is a genuine FAB bank statement
-   Verify the PDF is not password-protected or corrupted
