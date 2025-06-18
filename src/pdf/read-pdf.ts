import {existsSync} from 'fs-extra';
import {getDocument, VerbosityLevel} from 'pdfjs-dist/legacy/build/pdf';
import {DocumentInitParameters, PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api';

export async function readPdf(path: string): Promise<string[][]> {
    checkThatPdfExists(path);
    
    // Use custom positioning-based extraction instead of pdf-text-reader
    const document = await getPdfDocument(path);
    const pages: string[][] = [];
    
    for (let pageNum = 1; pageNum <= document.numPages; pageNum++) {
        const page = await document.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Group text items by Y position (preserve table structure)
        const itemsByY: { [y: number]: any[] } = {};
        textContent.items.forEach(item => {
            if ('str' in item && item.transform && item.transform[5] !== undefined) {
                const y = Math.round(item.transform[5]);
                if (!itemsByY[y]) itemsByY[y] = [];
                const yArray = itemsByY[y];
                if (yArray) {
                    yArray.push(item);
                }
            }
        });
        
        // Create lines sorted by Y position (top to bottom)
        const lines: string[] = [];
        Object.keys(itemsByY)
            .map(y => parseInt(y))
            .sort((a, b) => b - a) // Sort by Y descending (top to bottom)
            .forEach(y => {
                const lineData = itemsByY[y];
                if (lineData) {
                    const lineItems = lineData.sort((a, b) => a.transform[4] - b.transform[4]); // Sort by X
                    const lineText = lineItems.map(item => item.str).join(' ').trim();
                    if (lineText) {
                        lines.push(lineText);
                    }
                }
            });
        
        pages.push(lines);
    }
    
    return pages;
}

export async function getPdfDocument(path: string): Promise<PDFDocumentProxy> {
    checkThatPdfExists(path);
    return await getDocument(createSource(path)).promise;
}

function createSource(path: string): DocumentInitParameters {
    return {url: path, verbosity: VerbosityLevel.ERRORS};
}

export function checkThatPdfExists(filePath: string): void {
    if (!existsSync(filePath)) {
        throw new Error(`PDF file "${filePath}" does not exist`);
    }
}
