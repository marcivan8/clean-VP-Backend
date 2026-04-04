import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`BROWSER_ERROR: ${msg.text()}`);
        }
    });

    page.on('pageerror', err => {
        console.log(`PAGE_ERROR: ${err.message}`);
        console.log(`STACK: ${err.stack}`);
    });

    await page.goto('http://localhost:5173/editor', { waitUntil: 'networkidle2' }).catch(e => console.log('Goto Error:', e));
    
    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
})();
