import type { HtmlForgeProject } from "./types";
import { debounce } from "./utils";

export const GRAPESJS_INIT_BASE = {
  telemetry: false as false,
  storageManager: false as false,
  fromElement: false as false,
  height: "100%",
  width: "auto",
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

export interface EditorMountCallbacks {
  onChange(snapshot: EditorSnapshot): void;
  onError(error: Error): void;
}

export interface MountedEditor {
  destroy(): void;
  saveSnapshot(): EditorSnapshot;
  addPage(name: string): void;
  selectPage(id: string): void;
  getSelectedHtml(): string | undefined;
}

type GrapesEditor = {
  destroy: () => void;
  getProjectData: () => unknown;
  loadProjectData: (data: unknown) => void;
  getHtml: (options?: unknown) => string;
  getCss: (options?: unknown) => string;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
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

    let disposed = false;
    const emitChange = debounce(() => {
      if (disposed) return;
      callbacks.onChange(snapshotFromEditor(editor));
    }, 500);
    editor.on("update", emitChange);
    editor.on("component:add", emitChange);
    editor.on("component:remove", emitChange);
    editor.on("style:target", emitChange);

    return {
      destroy: () => {
        disposed = true;
        editor.destroy();
      },
      saveSnapshot: () => snapshotFromEditor(editor),
      addPage: (name: string) => {
        editor.Pages.add({ name, component: `<main><h1>${name}</h1><p>New screen.</p></main>` });
        emitChange();
      },
      selectPage: (id: string) => editor.Pages.select(id),
      getSelectedHtml: () => editor.DomComponents.getSelected?.()?.toHTML?.()
    };
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
