const fs = require('fs');
const path = require('path');

// Create the build timestamp
const buildTimestamp = new Date().toISOString();

// Create the timestamp object
const timestampData = {
  buildTime: buildTimestamp,
  buildTimeFormatted: new Date(buildTimestamp).toLocaleString()
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