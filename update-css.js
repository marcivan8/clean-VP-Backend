const fs = require('fs');

let indexHtml = fs.readFileSync('/Users/marcivanstevienguidjol/Documents/clean-VP-Backend/vibed-design-extracted/index.html', 'utf8');

// The closing tag might be <\/style> or <\u002Fstyle> or <\/style>
const styleRegex = /<style>([\s\S]*?)<[^\>]*style>/g;
let match;
const styles = [];
while ((match = styleRegex.exec(indexHtml)) !== null) {
  styles.push(match[1]);
}

if (styles.length < 2) {
  console.error("Could not find style tags. Length:", styles.length);
  process.exit(1);
}

let fontStyle = styles[0];
let varsStyle = styles[1];

// Fix font urls
// url("a8861c9e-30a1-4e3c-9084-b0141e93b321") -> url("/fonts/a8861c9e-30a1-4e3c-9084-b0141e93b321.woff2")
// Also handle case where it's escaped \"
fontStyle = fontStyle.replace(/url\(\\*["']?([^"'\)]+)\\*["']?\)/g, 'url("/fonts/$1.woff2")');
// Clean up any remaining escaped slashes
fontStyle = fontStyle.replace(/\\n/g, '\n').replace(/\\"/g, '"');
varsStyle = varsStyle.replace(/\\n/g, '\n').replace(/\\"/g, '"');


const newCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

${fontStyle}

@layer base {
${varsStyle.replace(/:root {/, ':root {\n  --background: var(--bg);\n  --foreground: var(--fg);\n  --card: var(--bg-2);\n  --card-foreground: var(--fg);\n  --popover: var(--bg-2);\n  --popover-foreground: var(--fg);\n  --primary: var(--accent);\n  --primary-foreground: #fff;\n  --secondary: var(--bg-3);\n  --secondary-foreground: var(--fg);\n  --muted: var(--glass);\n  --muted-foreground: var(--fg-3);\n  --border: var(--glass-stroke);\n  --input: var(--glass-stroke);\n  --ring: var(--accent);\n')}
}

@layer utilities {
  .glass-panel {
    @apply bg-[var(--glass)] border border-[var(--glass-stroke)] backdrop-blur-[20px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)];
  }
}
`;

// unescape newlines if any
const finalCss = newCss.replace(/\\n/g, '\n');

fs.writeFileSync('/Users/marcivanstevienguidjol/Documents/clean-VP-Backend/client/src/index.css', finalCss);
console.log('index.css updated');
