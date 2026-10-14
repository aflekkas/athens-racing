// Arena storage owns full course/friends state. Socket attachments only need
// bounded connection data for token lookup and the no-arena recovery fallback.
export function socketAttachment(data) {
  const { course, friendsSent, ...connection } = data;
  return connection;
}
