const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const fn = typeof pngToIco === 'function' ? pngToIco : pngToIco.default;

fn(path.join(__dirname, '..', 'assets', 'icon.png'))
  .then(buf => {
    fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.ico'), buf);
    console.log('ICO created with png-to-ico!');
  })
  .catch(err => {
    console.error('Error creating ico:', err);
  });
