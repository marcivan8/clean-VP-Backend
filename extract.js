const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

async function extract() {
    const htmlPath = '/Users/marcivanstevienguidjol/Downloads/Vibed.html';
    const outDir = '/Users/marcivanstevienguidjol/Documents/clean-VP-Backend/vibed-design-extracted';
    
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    const manifestMatch = htmlContent.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
    const extResMatch = htmlContent.match(/<script type="__bundler\/ext_resources">([\s\S]*?)<\/script>/);
    const templateMatch = htmlContent.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);

    if (!manifestMatch) {
        console.error("No manifest found");
        return;
    }

    const manifest = JSON.parse(manifestMatch[1]);
    const extRes = extResMatch ? JSON.parse(extResMatch[1]) : [];
    
    // Create a mapping from UUID to original filename
    const uuidToName = {};
    for (const res of extRes) {
        uuidToName[res.uuid] = res.id; // res.id is usually the path, e.g., "/src/App.css"
    }

    for (const [uuid, entry] of Object.entries(manifest)) {
        const filePath = uuidToName[uuid] || `unknown_${uuid}.${entry.mime.split('/')[1] || 'txt'}`;
        const absolutePath = path.join(outDir, filePath.replace(/^\//, ''));
        
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        
        const buffer = Buffer.from(entry.data, 'base64');
        let finalBuffer = buffer;
        
        if (entry.compressed) {
            try {
                finalBuffer = zlib.gunzipSync(buffer);
            } catch(e) {
                console.error(`Failed to unzip ${filePath}: ${e.message}`);
                continue;
            }
        }
        
        fs.writeFileSync(absolutePath, finalBuffer);
        console.log(`Extracted: ${filePath}`);
    }
    
    if (templateMatch) {
        fs.writeFileSync(path.join(outDir, 'index.html'), templateMatch[1]);
        console.log('Extracted: index.html');
    }
}

extract().catch(console.error);
