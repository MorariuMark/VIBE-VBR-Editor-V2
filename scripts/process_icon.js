const path = require('path');
const fs = require('fs');
const { Jimp } = require('jimp');
const pngToIco = require('png-to-ico');

const fn = typeof pngToIco === 'function' ? pngToIco : pngToIco.default;

async function processIcon() {
  try {
    const inputJpg = 'C:\\Users\\morar\\.gemini\\antigravity\\brain\\920be4ce-50f0-41d8-bf2d-40fd833e477e\\app_icon_vibe_1785413170359.jpg';
    const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
    const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');

    const image = await Jimp.read(inputJpg);
    await image.resize({ w: 256, h: 256 }).write(pngPath);
    console.log('Valid PNG written to:', pngPath);

    const buf = await fn(pngPath);
    fs.writeFileSync(icoPath, buf);
    console.log('Valid ICO written to:', icoPath);
  } catch (err) {
    console.error('Error processing icon:', err);
  }
}

processIcon();
