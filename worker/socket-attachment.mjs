// Arena storage owns full course state. Socket attachments only need
// bounded connection data for token lookup and the no-arena recovery fallback.
export function socketAttachment(data) {
  const { course, friendsSent, accountSub, accountName, ...connection } = data;
  return connection;
}
