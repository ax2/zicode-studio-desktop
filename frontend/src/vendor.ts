// Shared React vendor bundle, mapped via the index.html import map so every
// migrated feature reuses one copy of React instead of bundling its own.
// @ts-nocheck — aggregation entry only; esbuild bundles the real exports.
// React's CJS modules do not survive `export *` through esbuild's minifier, so
// re-export the exact names feature bundles import (resolved via the import map).
export {
  Children,
  Component,
  cloneElement,
  createContext,
  createElement,
  createRef,default, 
  forwardRef,
  isValidElement,
  lazy,
  memo,
  Suspense,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition
} from "react";
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
export { createPortal, flushSync } from "react-dom";
export { createRoot } from "react-dom/client";
