import {parsers, ParserType} from '..';

const fabParser = parsers[ParserType.FabBank];
fabParser
    .parsePdf({
        filePath: 'path/to/fab-statement.pdf',
        parserOptions: {
            yearPrefix: 20,
        },
    })
    .then((result) => console.log(result));
