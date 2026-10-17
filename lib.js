// Images are stored as base64 data URLs (resized in the browser) and served through /image endpoints.
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const validImage = (s, max) => typeof s === 'string' && s.length <= max && IMG.test(s);

function sendImage(res, dataUrl) {
  if (!dataUrl) return res.status(404).json({ error: 'No image' });
  const [head, b64] = dataUrl.split(',');
  res.set('Content-Type', head.slice(5, head.indexOf(';')));
  res.set('Cache-Control', 'no-cache');
  res.send(Buffer.from(b64, 'base64'));
}
module.exports = { validImage, sendImage };
