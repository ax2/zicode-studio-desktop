export { createModelDropdownFeed } from "./modelDropdown";
export type { ModelDropdownFeed, ModelDropdownSnapshot, ModelLike } from "./modelDropdown";
export { defaultProcessImageFile } from "./imageLogic";
export type { ImageItem } from "./imageLogic";
export {
  activeSlashQuery,
  computeSlashMatches,
  titleCaseCommandName,
} from "./slashMenu";
export type { SlashCommand, SlashMenuState } from "./slashMenu";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { create } from "zustand";
import { t } from "../../shared/i18n";
import { ComposerApp, type ComposerStore } from "./ComposerApp";
import {
  defaultProcessImageFile,
  filterImageFiles,
  type ImageItem,
} from "./imageLogic";
import { EMPTY_SLASH_STATE, computeSlashMatches } from "./slashMenu";
import {
  getComposerStore,
  setComposerStore,
} from "./composerStore";
import type { SlashCommand } from "./slashMenu";
// @ts-expect-error plain JS modules without type declarations (public/)
import { MOBILE_SHELL_QUERY } from "../../../../public/ui/sidebar-toggle.js";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { setupMobileHistoryLayer } from "../../../../public/native/utils/mobile-history-layer.js";

export interface ComposerElements {
  input: HTMLTextAreaElement;
  form: HTMLFormElement;
  abortButton: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  composerCard: HTMLElement;
  commandButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
  imageInput: HTMLInputElement;
  imagePreviews: HTMLElement;
  skillSlashMenu: HTMLElement;
  queuedMessages: HTMLElement;
  modelDropdown: HTMLElement;
  modelDropdownBtn: HTMLButtonElement;
  modelDropdownLabel: HTMLElement;
  modelDropdownMenu: HTMLElement;
  thinkingBtn: HTMLButtonElement;
}

export interface ComposerSubmitOptions {
  altKey: boolean;
}

export interface ComposerHandle extends ComposerElements {
  setQueue(queue: { steering?: string[]; followUp?: string[] }): void;
  dispose(): void;
}

export function setupComposer(
  options: { onSubmit?: (submit: ComposerSubmitOptions) => void } = {},
): ComposerHandle | null {
  const rootElement = document.getElementById("composer-root");
  if (!rootElement) return null;
  let imageKeyCounter = 0;
  const nextImageKey = () => `composer-image-${++imageKeyCounter}`;
  const store = create<ComposerStore>()((set) => ({
    queue: {},
    setQueue: (queue) => set({ queue }),
    slash: EMPTY_SLASH_STATE,
    setSlash: (patch) =>
      set((state) => ({ slash: { ...state.slash, ...patch } })),
    getCommands: () => [],
    setGetCommands: (getCommands) => set({ getCommands }),
    images: [],
    imageKeys: [],
    setImages: (images) =>
      set(() => ({
        images,
        imageKeys: images.map(() => nextImageKey()),
      })),
    addImage: (image) =>
      set((state) => ({
        images: [...state.images, image],
        imageKeys: [...state.imageKeys, nextImageKey()],
      })),
    removeImageAt: (index) =>
      set((state) => ({
        images: state.images.filter((_, i) => i !== index),
        imageKeys: state.imageKeys.filter((_, i) => i !== index),
      })),
    imageBusy: 0,
    setImageBusy: (imageBusy) => set({ imageBusy }),
    imagePickerOpen: false,
    setImagePickerOpen: (imagePickerOpen) => set({ imagePickerOpen }),
    pickerActions: null,
    setPickerActions: (pickerActions) => set({ pickerActions }),
  }));
  setComposerStore(store);
  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(rootElement);
    root.render(
      createElement(ComposerApp, { store, onSubmit: options.onSubmit }),
    );
  });
  const required = <T,>(element: T | null): T => {
    if (!element) throw new Error("composer element missing");
    return element;
  };
  const elements: ComposerElements = {
    input: required(document.getElementById("message-input") as HTMLTextAreaElement | null),
    form: required(document.getElementById("chat-form") as HTMLFormElement | null),
    abortButton: required(document.getElementById("abort-btn") as HTMLButtonElement | null),
    sendButton: required(document.getElementById("send-btn") as HTMLButtonElement | null),
    composerCard: required(document.getElementById("composer-card") as HTMLElement | null),
    commandButton: required(document.getElementById("command-btn") as HTMLButtonElement | null),
    attachButton: required(document.getElementById("attach-btn") as HTMLButtonElement | null),
    imageInput: required(document.getElementById("image-input") as HTMLInputElement | null),
    imagePreviews: required(document.getElementById("image-previews") as HTMLElement | null),
    skillSlashMenu: required(document.getElementById("skill-slash-menu") as HTMLElement | null),
    queuedMessages: required(document.getElementById("queued-messages") as HTMLElement | null),
    modelDropdown: required(document.getElementById("model-dropdown") as HTMLElement | null),
    modelDropdownBtn: required(
      document.getElementById("model-dropdown-btn") as HTMLButtonElement | null,
    ),
    modelDropdownLabel: required(
      document.getElementById("model-dropdown-label") as HTMLElement | null,
    ),
    modelDropdownMenu: required(document.getElementById("model-dropdown-menu") as HTMLElement | null),
    thinkingBtn: required(document.getElementById("thinking-btn") as HTMLButtonElement | null),
  };
  return {
    ...elements,
    setQueue: (queue) => store.getState().setQueue(queue),
    dispose: () => {
      root?.unmount();
      setComposerStore(null);
    },
  };
}

export function setupComposerSlashMenu({
  input,
  container,
  commandButton = null,
  getCommands,
}: {
  input?: HTMLTextAreaElement | null;
  container?: HTMLElement | null;
  commandButton?: HTMLButtonElement | null;
  getCommands: () => SlashCommand[];
}): { close(): void; update(): void; openAll(): void } {
  const store = getComposerStore();
  if (!store || !input) return { close() {}, update() {}, openAll() {} };
  // The menu listbox is owned by the React composer shell; the container
  // argument is accepted for call-site compatibility only.
  void container;
  store.getState().setGetCommands(getCommands);

  const close = () => store.getState().setSlash(EMPTY_SLASH_STATE);

  const openAll = () => {
    const state = store.getState();
    const computed = computeSlashMatches(input, state.getCommands());
    if (computed) {
      state.setSlash({
        open: true,
        query: computed.query,
        matches: computed.matches,
        selectedIndex: 0,
      });
    } else if (input.value.trim().length === 0) {
      input.value = "/";
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.focus();
  };

  const update = () => {
    const state = store.getState();
    const computed = computeSlashMatches(input, state.getCommands());
    if (!computed) {
      state.setSlash(EMPTY_SLASH_STATE);
      return;
    }
    state.setSlash({
      open: true,
      query: computed.query,
      matches: computed.matches,
      selectedIndex: Math.min(
        state.slash.selectedIndex,
        Math.max(computed.matches.length - 1, 0),
      ),
    });
  };

  commandButton?.addEventListener("click", openAll);
  return { close, update, openAll };
}

export interface ImageAttachmentsHandle {
  addFiles(files: FileList | File[]): Promise<void>;
  getImages(): ImageItem[];
  setImages(images: ImageItem[]): void;
  clear(): void;
  whenIdle(): Promise<unknown>;
  dispose(): void;
}

export function setupComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer,
  dropTarget,
  processImageFile = defaultProcessImageFile,
  onError = console.error,
  onBusyChange = () => {},
  onChange = () => {},
}: {
  input?: HTMLTextAreaElement | null;
  attachButton?: HTMLButtonElement | null;
  imageInput?: HTMLInputElement | null;
  previewContainer?: HTMLElement | null;
  dropTarget?: HTMLElement | null;
  processImageFile?: (file: File) => Promise<ImageItem>;
  onError?: (error: Error) => void;
  onBusyChange?: (busy: boolean) => void;
  onChange?: () => void;
}): ImageAttachmentsHandle {
  const store = getComposerStore();
  if (!store || !previewContainer) {
    return {
      async addFiles() {},
      getImages: () => [],
      setImages() {},
      clear() {},
      whenIdle: async () => {},
      dispose() {},
    };
  }
  // The preview container is rendered by the React composer shell; the
  // argument is accepted for call-site compatibility only.
  void previewContainer;
  const activeStore = store;

  let processing = Promise.resolve();
  let pendingFileCount = 0;

  const unsubscribe = activeStore.subscribe((state, prev) => {
    if (state.images !== prev.images) onChange();
  });

  function addFiles(files: FileList | File[] | null | undefined): Promise<void> {
    const imageFiles = filterImageFiles(files);
    if (imageFiles.length === 0) return processing;
    pendingFileCount += imageFiles.length;
    onBusyChange(true);
    activeStore.getState().setImageBusy(pendingFileCount);
    const batch = processing.then(async () => {
      for (const file of imageFiles) {
        try {
          const image = await processImageFile(file);
          activeStore
            .getState()
            .addImage(image);
        } catch (error) {
          console.warn("[Composer] Image processing failed:", error);
          onError(
            new Error(t("Could not add this image. Try a smaller PNG or JPEG.")),
          );
        } finally {
          pendingFileCount -= 1;
          activeStore.getState().setImageBusy(pendingFileCount);
        }
      }
    });
    processing = batch.finally(() => {
      if (pendingFileCount === 0) onBusyChange(false);
    });
    return processing;
  }

  function getImages(): ImageItem[] {
    return activeStore.getState().images.map((image) => ({ ...image }));
  }

  function setImages(images: ImageItem[]) {
    activeStore
      .getState()
      .setImages(Array.from(images ?? []).map((image) => ({ ...image })));
  }

  function clear() {
    if (activeStore.getState().images.length > 0) {
      activeStore.getState().setImages([]);
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length > 0) addFiles(files);
  };
  const onDragOver = (event: DragEvent) => event.preventDefault();
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    addFiles(event.dataTransfer?.files);
  };
  input?.addEventListener("paste", onPaste);
  dropTarget?.addEventListener("dragover", onDragOver);
  dropTarget?.addEventListener("drop", onDrop);

  const picker = setupComposerImagePicker({
    attachButton,
    galleryInput: imageInput,
    onFiles: addFiles,
  });

  return {
    addFiles,
    getImages,
    setImages,
    clear,
    whenIdle: () => processing,
    dispose() {
      unsubscribe();
      input?.removeEventListener("paste", onPaste);
      dropTarget?.removeEventListener("dragover", onDragOver);
      dropTarget?.removeEventListener("drop", onDrop);
      picker.dispose();
    },
  };
}

export function setupComposerImagePicker({
  attachButton,
  galleryInput,
  onFiles = () => {},
  windowRef = globalThis.window,
  documentRef = globalThis.document,
}: {
  attachButton?: HTMLButtonElement | null;
  galleryInput?: HTMLInputElement | null;
  onFiles?: (files: FileList | File[]) => void;
  windowRef?: Window & typeof globalThis;
  documentRef?: Document;
} = {}): { close(options?: object): void; dispose(): void } {
  const store = getComposerStore();
  if (!store || !attachButton || !galleryInput || !documentRef?.body) {
    return { close() {}, dispose() {} };
  }
  const activeStore = store;
  const activeAttach = attachButton;
  const activeGallery = galleryInput;

  const mobileMedia = windowRef.matchMedia?.(MOBILE_SHELL_QUERY);
  const isMobile = () => mobileMedia?.matches ?? windowRef.innerWidth <= 768;
  const cameraInput = documentRef.createElement("input");
  cameraInput.type = "file";
  cameraInput.accept = "image/*";
  cameraInput.hidden = true;
  cameraInput.setAttribute("capture", "environment");
  documentRef.body.append(cameraInput);

  const historyLayer = setupMobileHistoryLayer({
    id: "composer-image-picker",
    isActive: () => activeStore.getState().imagePickerOpen,
    onBack: () => close({ restoreFocus: true, fromHistory: true }),
    windowRef,
  });

  function close({
    restoreFocus = false,
    fromHistory = false,
    discardHistory = false,
  }: {
    restoreFocus?: boolean;
    fromHistory?: boolean;
    discardHistory?: boolean;
  } = {}) {
    if (!activeStore.getState().imagePickerOpen) return;
    activeStore.getState().setImagePickerOpen(false);
    if (!fromHistory) historyLayer?.leave({ replace: discardHistory });
    if (restoreFocus) activeAttach.focus({ preventScroll: true });
  }

  function open() {
    historyLayer?.enter();
    activeStore.getState().setImagePickerOpen(true);
  }

  function choose(input: HTMLInputElement) {
    close({ discardHistory: true });
    input.click();
  }

  function handleInput(input: HTMLInputElement) {
    const files = input.files;
    if (files?.length) void onFiles(files);
    input.value = "";
  }

  const onAttach = () => {
    if (isMobile()) open();
    else activeGallery.click();
  };
  const onMediaChange = () => {
    if (!isMobile()) close({ discardHistory: true });
  };
  const onCameraFiles = () => handleInput(cameraInput);
  const onGalleryFiles = () => handleInput(activeGallery);

  activeAttach.addEventListener("click", onAttach);
  cameraInput.addEventListener("change", onCameraFiles);
  activeGallery.addEventListener("change", onGalleryFiles);
  mobileMedia?.addEventListener?.("change", onMediaChange);

  activeStore.getState().setPickerActions({
    close: () => close({ restoreFocus: true }),
    chooseCamera: () => choose(cameraInput),
    chooseGallery: () => choose(activeGallery),
  });

  return {
    close,
    dispose() {
      close({ discardHistory: true });
      historyLayer?.dispose();
      activeAttach.removeEventListener("click", onAttach);
      cameraInput.removeEventListener("change", onCameraFiles);
      activeGallery.removeEventListener("change", onGalleryFiles);
      mobileMedia?.removeEventListener?.("change", onMediaChange);
      cameraInput.remove();
      activeStore.getState().setPickerActions(null);
    },
  };
}
