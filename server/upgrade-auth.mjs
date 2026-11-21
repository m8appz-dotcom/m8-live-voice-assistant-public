/** End rejected upgrades with an explicit HTTP status; never open a relay. */
export function rejectWebSocketUpgrade(socket, authorization) {
  const status = authorization.reason === 'origin not allowed' ? 403 : authorization.code === 1011 ? 503 : 401
  const phrase = status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : 'Unauthorized'
  socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}
