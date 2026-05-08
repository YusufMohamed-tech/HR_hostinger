const fs = require('fs');
const path = require('path');
const dir = 'src/components/forms';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));
files.forEach(file => {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, 'utf8');
  
  text = text.replace(/key=\{String\(emp\.id\)\}\s*value=\{String\(([a-zA-Z0-9_\.]+)\.id\)\}/g, 'key={String($1.id)} value={String($1.id)}');
  
  fs.writeFileSync(p, text);
});
console.log('Done');
