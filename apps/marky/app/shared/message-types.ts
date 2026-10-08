// Wire-format message tags. Each binary frame begins with one of these bytes.
export const MESSAGE_TYPE_SYNC = 0;
export const MESSAGE_TYPE_AWARENESS = 1;
export const MESSAGE_TYPE_FILE_LIST = 2;
export const MESSAGE_TYPE_OPEN_FILE = 3;
// 4 was MESSAGE_TYPE_PERSIST_FILE; removed once auto-persist replaced the
// manual button. The tag value is intentionally left unused so we never
// recycle it onto a frame with different semantics.
export const MESSAGE_TYPE_SUBDOC_SYNC = 5;
export const MESSAGE_TYPE_SUBDOC_AWARENESS = 6;
export const MESSAGE_TYPE_RENAME_FILE = 7;
export const MESSAGE_TYPE_DELETE_FILE = 8;
export const MESSAGE_TYPE_ERROR = 9;

export type MessageType =
  | typeof MESSAGE_TYPE_SYNC
  | typeof MESSAGE_TYPE_AWARENESS
  | typeof MESSAGE_TYPE_FILE_LIST
  | typeof MESSAGE_TYPE_OPEN_FILE
  | typeof MESSAGE_TYPE_SUBDOC_SYNC
  | typeof MESSAGE_TYPE_SUBDOC_AWARENESS
  | typeof MESSAGE_TYPE_RENAME_FILE
  | typeof MESSAGE_TYPE_DELETE_FILE
  | typeof MESSAGE_TYPE_ERROR;
