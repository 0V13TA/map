// =========================
// ENUMS & ACTIONS
// =========================
export const TOOLS = {
  LINE: "line",
  NGON: "ngon",
  ZOOM: "zoom",
  DRAG: "drag",
  ENTITY: "entity",
};

export const ACTIONS = {
  UNDO: "undo",
  REDO: "redo",

  SELECT_ALL: "select_all",

  SET_TOOL_LINE: "set_tool_line",
  SET_TOOL_NGON: "set_tool_ngon",
  SET_TOOL_ZOOM: "set_tool_zoom",
  SET_TOOL_DRAG: "set_tool_drag",

  PAN_UP: "pan_up",
  PAN_DOWN: "pan_down",
  PAN_LEFT: "pan_left",
  PAN_RIGHT: "pan_right",

  DELETE_SELECTION: "delete_selection",
  ROTATE_SELECTION: "rotate_selection",
};

export const DEFAULT_KEY_BINDINGS = {
  "Ctrl+KeyZ": ACTIONS.UNDO,
  "Ctrl+KeyY": ACTIONS.REDO,
  "Ctrl+KeyA": ACTIONS.SELECT_ALL,

  KeyR: ACTIONS.ROTATE_SELECTION,

  Digit1: ACTIONS.SET_TOOL_LINE,
  Digit3: ACTIONS.SET_TOOL_NGON,
  Digit4: ACTIONS.SET_TOOL_ZOOM,
  Digit5: ACTIONS.SET_TOOL_DRAG,

  // Arrow fallbacks for precise canvas movement panning
  ArrowUp: ACTIONS.PAN_UP,
  ArrowDown: ACTIONS.PAN_DOWN,
  ArrowLeft: ACTIONS.PAN_LEFT,
  ArrowRight: ACTIONS.PAN_RIGHT,

  Delete: ACTIONS.DELETE_SELECTION,
};
