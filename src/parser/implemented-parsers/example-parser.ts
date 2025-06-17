import {createDateFromUtcIsoFormat, removeCommasFromNumberString, safeMatch} from 'augment-vir';
import {ParsedOutput, ParsedTransaction} from '../parsed-output';
import {createStatementParser} from '../statement-parser';

enum State {
    Header = 'header',
    InnerState = 'inner-state',
    End = 'end',
}

export const exampleStatementParser = createStatementParser<State, ParsedOutput>({
    action: performStateAction,
    next: nextState,
    initialState: State.Header,
    endState: State.End,
    parserKeywords: [],
});

const validPaymentRegExp = /(\d{2}\/\d{2})\s+(.+)\$([-,.\d]+)/;

function readPayment(line: string): ParsedTransaction | undefined {
    const [
        ,
        dateString,
        descriptionString,
        amountString,
    ] = safeMatch(line, validPaymentRegExp);

    if (dateString && descriptionString && amountString) {
        return {
            amount: Number(removeCommasFromNumberString(amountString)),
            description: descriptionString,
            date: createDateFromUtcIsoFormat(dateString),
            originalText: [line],
        };
    } else {
        return undefined;
    }
}

function performStateAction(currentState: State, line: string, output: ParsedOutput) {
    if (currentState === State.InnerState && line.match(validPaymentRegExp)) {
        const transaction = readPayment(line);
        if (transaction) {
            output.incomes.push(transaction);
        }
    }

    return output;
}

function nextState(currentState: State, line: string): State {
    line = line.toLowerCase();

    switch (currentState) {
        case State.Header:
            return State.InnerState;
        case State.InnerState:
            if (line === 'end inner state') {
                return State.End;
            }
            break;
        case State.End:
            break;
    }

    return currentState;
}
