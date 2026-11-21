import http from 'http'
const body = JSON.stringify({ text: 'Titan dice: este es un mensaje proactivo de prueba' })
const req = http.request({
  hostname: 'localhost', port: 7300,
  path: '/api/inject', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => console.log('RESULT:', d))
})
req.write(body)
req.end()
