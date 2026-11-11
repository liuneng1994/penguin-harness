import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "code-viewer.card",
        title: "Code Viewer",
        titleZh: "代码查看器",
        descriptionZh: "在聊天中点击文件位置，居中查看代码与上下文。",
        shortDescription: "Read code and context directly from chat file references.",
        shortDescriptionZh: "从聊天中的文件引用查看代码与上下文。",
        category: "software-development",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Explain a function in this workspace and cite its file and line range.",
          promptZh: "解释工作区中的一个函数，并引用文件和行号范围。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "code-viewer.workbench.code-viewer",
        name: "code-viewer",
        path: "workbenches/code-viewer",
      },
    ],
  },
})
export class CodeViewerPlugin {}
export default { modules: [CodeViewerPlugin] } satisfies Plugin;
