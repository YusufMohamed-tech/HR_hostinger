const fs = require('fs');
const path = require('path');
const dir = 'src/components/forms';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));
files.forEach(file => {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, 'utf8');
  
  text = text.replace(/\(v\)\s*=>\s*set\("([^"]+)",\s*v\)/g, '(v) => set("$1", v || "")');
  text = text.replace(/\(v\)\s*=>\s*setManagerId\(v\)/g, '(v) => setManagerId(v || "")');
  
  fs.writeFileSync(p, text);
});
console.log('Done');
