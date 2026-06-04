import type { HtmlForgeProject } from "./types";
import { debounce } from "./utils";

export const GRAPESJS_INIT_BASE = {
  telemetry: false as false,
  storageManager: false as false,
  fromElement: false as false,
  height: "100%",
  width: "auto",
  dragMode: "absolute" as const,
  noticeOnUnload: false,
  cssIcons: "",
  canvas: {
    scripts: [] as Array<string | Record<string, unknown>>,
    styles: [] as Array<string | Record<string, unknown>>
  },
  panels: {
    defaults: [] as Array<Record<string, unknown>>
  }
};

export interface EditorSnapshot {
  grapesProjectData: unknown;
  pages: Array<{ id?: string; name: string; html: string; css: string }>;
}

export interface SelectedComponentSnapshot {
  name: string;
  tagName: string;
  text: string;
  width: string;
  height: string;
  background: string;
  color: string;
  padding: string;
  radius: string;
}

export interface EditorMountCallbacks {
  onChange(snapshot: EditorSnapshot): void;
  onSelection(snapshot?: SelectedComponentSnapshot): void;
  onError(error: Error): void;
}

export interface MountedEditor {
  destroy(): void;
  saveSnapshot(): EditorSnapshot;
  addPage(name: string, id?: string): void;
  selectPage(id: string): void;
  insertBlock(block: string): void;
  getSelectedHtml(): string | undefined;
  getSelectedSnapshot(): SelectedComponentSnapshot | undefined;
  updateSelected(change: Partial<SelectedComponentSnapshot>): void;
  deleteSelected(): void;
  setZoom(value: number): number;
  zoomBy(delta: number): number;
  fitCanvas(): number;
  refreshCanvas(): void;
}

type GrapesComponent = {
  get?: (key: string) => unknown;
  set?: (key: string | Record<string, unknown>, value?: unknown, opts?: unknown) => void;
  getName?: () => string;
  setName?: (name: string) => void;
  getStyle?: () => Record<string, string>;
  setStyle?: (style: Record<string, string>, opts?: unknown) => Record<string, string>;
  append?: (content: string) => unknown;
  components?: (content?: string) => GrapesComponent[] | { forEach?: (callback: (component: GrapesComponent) => void) => void };
  toHTML?: () => string;
};

type GrapesEditor = {
  destroy: () => void;
  getProjectData: () => unknown;
  loadProjectData: (data: unknown) => void;
  getHtml: (options?: unknown) => string;
  getCss: (options?: unknown) => string;
  addComponents: (components: string, opts?: unknown) => unknown;
  getSelected: () => GrapesComponent | undefined;
  getWrapper: () => GrapesComponent | undefined;
  runCommand: (id: string, opts?: unknown) => unknown;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  Canvas: {
    setZoom: (value: number | string, opts?: unknown) => unknown;
    getZoom: () => number;
    fitViewport: (opts?: unknown) => void;
    refresh: (opts?: unknown) => void;
  };
  Pages: {
    getAll: () => Array<{
      id?: string;
      get?: (key: string) => unknown;
      getMainComponent: () => unknown;
    }>;
    add: (page: { id?: string; name: string; component: string }) => unknown;
    select: (id: string) => void;
  };
  BlockManager: {
    add: (id: string, block: Record<string, unknown>) => void;
  };
  DomComponents: {
    getSelected?: () => { toHTML?: () => string } | undefined;
  };
};

function pageComponent(project: HtmlForgeProject, index: number): string {
  const page = project.pages[index];
  if (!page) return "<main><h1>Empty page</h1></main>";
  return `<style>${page.css}</style>${page.html}`;
}

function projectDataFromProject(project: HtmlForgeProject): unknown {
  return (
    project.grapesProjectData ?? {
      pages: project.pages.map((page, index) => ({
        id: page.id,
        name: page.name,
        component: pageComponent(project, index)
      }))
    }
  );
}

function snapshotFromEditor(editor: GrapesEditor): EditorSnapshot {
  const pages = editor.Pages.getAll().map((page) => {
    const component = page.getMainComponent();
    return {
      id: page.id,
      name: String(page.get?.("name") ?? page.id ?? "Page"),
      html: editor.getHtml({ component }),
      css: editor.getCss({ component })
    };
  });
  return {
    grapesProjectData: editor.getProjectData(),
    pages
  };
}

export async function mountGrapesEditor(container: HTMLElement, project: HtmlForgeProject, callbacks: EditorMountCallbacks): Promise<MountedEditor> {
  container.innerHTML = '<div class="gjs-host" aria-label="Visual editor"></div>';
  const host = container.querySelector<HTMLElement>(".gjs-host");
  if (!host) throw new Error("Editor host failed to mount.");

  try {
    await import("grapesjs/dist/css/grapes.min.css");
    const module = await import("grapesjs");
    const grapesjs = module.default;
    const editor = grapesjs.init({
      ...GRAPESJS_INIT_BASE,
      container: host,
      projectData: projectDataFromProject(project) as Record<string, unknown>
    }) as unknown as GrapesEditor;

    editor.BlockManager.add("hf-section", {
      label: "Section",
      category: "HTML Forge",
      content: '<section class="hf-section"><h2>Section heading</h2><p>Describe this screen.</p></section>'
    });
    editor.BlockManager.add("hf-button", {
      label: "Button",
      category: "HTML Forge",
      content: '<button class="hf-button" type="button">Button</button>'
    });
    editor.BlockManager.add("hf-card", {
      label: "Card",
      category: "HTML Forge",
      content: '<article class="hf-card"><h3>Card title</h3><p>Card content.</p></article>'
    });
    editor.BlockManager.add("hf-input", {
      label: "Input",
      category: "HTML Forge",
      content: '<label class="hf-field">Label <input type="text" placeholder="Value"></label>'
    });

    const makeEditable = (component?: GrapesComponent): void => {
      if (!component?.set) return;
      component.set({
        draggable: true,
        droppable: true,
        editable: true,
        hoverable: true,
        selectable: true,
        resizable: {
          tl: true,
          tc: true,
          tr: true,
          cl: true,
          cr: true,
          bl: true,
          bc: true,
          br: true
        }
      });
      const children = component.components?.();
      children?.forEach?.((child) => makeEditable(child));
    };

    const blockContent = (block: string): string => {
      const blocks: Record<string, string> = {
        section: '<section class="hf-section"><h2>Section heading</h2><p>Describe this screen.</p></section>',
        card: '<article class="hf-card"><h3>Card title</h3><p>Card content.</p></article>',
        button: '<button class="hf-button" type="button">Button</button>',
        input: '<label class="hf-field">Label <input type="text" placeholder="Value"></label>'
      };
      return blocks[block] ?? blocks.section;
    };

    const selectedSnapshot = (): SelectedComponentSnapshot | undefined => {
      const selected = editor.getSelected();
      if (!selected) return undefined;
      const style = selected.getStyle?.() ?? {};
      const tagName = String(selected.get?.("tagName") ?? "element");
      const html = selected.toHTML?.() ?? "";
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return {
        name: selected.getName?.() ?? tagName,
        tagName,
        text,
        width: style.width ?? "",
        height: style.height ?? "",
        background: style["background-color"] ?? style.background ?? "",
        color: style.color ?? "",
        padding: style.padding ?? "",
        radius: style["border-radius"] ?? ""
      };
    };

    makeEditable(editor.getWrapper());

    let disposed = false;
    const emitChange = debounce(() => {
      if (disposed) return;
      callbacks.onChange(snapshotFromEditor(editor));
    }, 500);
    editor.on("update", emitChange);
    editor.on("component:add", emitChange);
    editor.on("component:add", (component) => makeEditable(component as GrapesComponent));
    editor.on("component:remove", emitChange);
    editor.on("style:target", emitChange);
    editor.on("component:selected", (component) => {
      makeEditable(component as GrapesComponent);
      callbacks.onSelection(selectedSnapshot());
    });
    editor.on("component:deselected", () => callbacks.onSelection(undefined));
    editor.on("load", () => {
      makeEditable(editor.getWrapper());
      editor.Canvas.fitViewport({ clb: () => editor.Canvas.setZoom(90) });
    });

    return {
      destroy: () => {
        disposed = true;
        editor.destroy();
      },
      saveSnapshot: () => snapshotFromEditor(editor),
      addPage: (name: string, id?: string) => {
        editor.Pages.add({ id, name, component: `<main><h1>${name}</h1><p>New screen.</p></main>` });
        emitChange();
      },
      selectPage: (id: string) => editor.Pages.select(id),
      insertBlock: (block: string) => {
        const content = blockContent(block);
        const selected = editor.getSelected();
        if (selected?.append) selected.append(content);
        else editor.addComponents(content);
        makeEditable(editor.getSelected() ?? editor.getWrapper());
        editor.Canvas.refresh();
        emitChange();
      },
      getSelectedHtml: () => editor.DomComponents.getSelected?.()?.toHTML?.(),
      getSelectedSnapshot: selectedSnapshot,
      updateSelected: (change) => {
        const selected = editor.getSelected();
        if (!selected) return;
        if (change.name !== undefined) selected.setName?.(change.name);
        if (change.text !== undefined) selected.components?.(change.text);
        const current = selected.getStyle?.() ?? {};
        const next = { ...current };
        if (change.width !== undefined) next.width = change.width;
        if (change.height !== undefined) next.height = change.height;
        if (change.background !== undefined) next["background-color"] = change.background;
        if (change.color !== undefined) next.color = change.color;
        if (change.padding !== undefined) next.padding = change.padding;
        if (change.radius !== undefined) next["border-radius"] = change.radius;
        selected.setStyle?.(next);
        editor.Canvas.refresh();
        emitChange();
        callbacks.onSelection(selectedSnapshot());
      },
      deleteSelected: () => {
        editor.runCommand("core:component-delete");
        emitChange();
        callbacks.onSelection(undefined);
      },
      setZoom: (value: number) => {
        const next = Math.min(160, Math.max(25, value));
        editor.Canvas.setZoom(next);
        return editor.Canvas.getZoom();
      },
      zoomBy: (delta: number) => {
        const next = Math.round(editor.Canvas.getZoom() + delta);
        editor.Canvas.setZoom(Math.min(160, Math.max(25, next)));
        return editor.Canvas.getZoom();
      },
      fitCanvas: () => {
        editor.Canvas.fitViewport();
        return editor.Canvas.getZoom();
      },
      refreshCanvas: () => editor.Canvas.refresh()
    };
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
