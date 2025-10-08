const fs = require('fs');
const path = require('path');

// Create the build timestamp
const now = new Date();
const buildTimestamp = now.toISOString();

// Create the timestamp object with proper local timezone formatting
const timestampData = {
  buildTime: buildTimestamp,
  buildTimeFormatted: now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  })
};

// Ensure the src directory exists
const srcDir = path.join(__dirname, '..', 'src');
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
}

// Write the timestamp to a TypeScript file
const timestampFilePath = path.join(srcDir, 'buildTimestamp.ts');
const fileContent = `// This file is auto-generated during build
export const BUILD_TIMESTAMP = ${JSON.stringify(timestampData, null, 2)};
`;

fs.writeFileSync(timestampFilePath, fileContent);

console.log(`Build timestamp generated: ${buildTimestamp}`);