// Shared React vendor bundle, mapped via the index.html import map so every
// migrated feature reuses one copy of React instead of bundling its own.
// @ts-nocheck — aggregation entry only; esbuild bundles the real exports.
// React's CJS modules do not survive `export *` through esbuild's minifier, so
// re-export the exact names feature bundles import (resolved via the import map).
export {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
  useReducer,
  useContext,
  useLayoutEffect,
  useId,
  useDebugValue,
  createElement,
  createContext,
  createRef,
  forwardRef,
  memo,
  lazy,
  Suspense,
  isValidElement,
  cloneElement,
  Children,
  startTransition,
  useTransition,
  useDeferredValue,
  useOptimistic,
  useActionState,
} from "react";
export { default } from "react";
export { flushSync, createPortal } from "react-dom";
export { createRoot } from "react-dom/client";
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
