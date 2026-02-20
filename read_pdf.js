const fs = require('fs');
const pdfParse = require('pdf-parse');

let dataBuffer = fs.readFileSync('strategy_flow.pdf');

console.log('Type of pdfParse:', typeof pdfParse);

if (typeof pdfParse === 'function') {
    pdfParse(dataBuffer).then(function(data) {
        console.log(data.text);
    }).catch(function(error){
        console.error("Error: " + error);
    });
} else {
    console.log('pdfParse is not a function. Keys:', Object.keys(pdfParse));
    if (pdfParse.default) {
         pdfParse.default(dataBuffer).then(function(data) {
            console.log(data.text);
        }).catch(function(error){
            console.error("Error: " + error);
        });
    }
}
