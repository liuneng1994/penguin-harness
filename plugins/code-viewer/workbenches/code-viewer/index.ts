import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: {
    Workbench: {
      create() {
        return {
          api: {
            main: {
              async handle() {
                return { status: 404, body: { error: "not_found" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
