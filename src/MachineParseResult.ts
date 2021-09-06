import { Action, Condition } from "xstate";
import * as t from "@babel/types";
import { TMachineCallExpression } from "./machineCallExpression";
import { StateNodeReturn } from "./stateNode";
import { toMachineConfig } from "./toMachineConfig";
import { StringLiteralNode } from "./types";
import { TransitionConfigNode } from "./transitions";
import { ActionNode } from "./actions";

/**
 * Gives some helpers to the user of the lib
 */
export class MachineParseResult {
  ast: TMachineCallExpression;
  private stateNodes: { path: string[]; ast: StateNodeReturn }[];

  constructor(props: { ast: TMachineCallExpression }) {
    this.ast = props.ast;

    this.stateNodes = this._getAllStateNodes();
  }

  private _getAllStateNodes = (): {
    path: string[];
    ast: StateNodeReturn;
  }[] => {
    if (!this.ast?.definition) return [];
    const nodes = [] as { path: string[]; ast: StateNodeReturn }[];

    const getSubNodes = (
      definition: StateNodeReturn | undefined,
      path: string[],
    ) => {
      if (definition) {
        nodes.push({
          ast: definition,
          path,
        });
      }
      definition?.states?.properties.forEach((stateNode) => {
        getSubNodes(stateNode.result, [...path, stateNode.key]);
      });
    };

    getSubNodes(this.ast?.definition, []);

    return nodes;
  };

  getTransitions = () => {
    const targets: { config: TransitionConfigNode; fromPath: string[] }[] = [];

    this.stateNodes.forEach((stateNode) => {
      stateNode.ast.on?.properties.forEach((on) => {
        on.result.forEach((transition) => {
          targets.push({
            config: transition,
            fromPath: stateNode.path,
          });
        });
      });
      stateNode.ast.onDone?.forEach((transition) => {
        targets.push({
          config: transition,
          fromPath: stateNode.path,
        });
      });
      stateNode.ast.invoke?.forEach((invoke) => {
        invoke.onDone?.forEach((transition) => {
          targets.push({
            config: transition,
            fromPath: stateNode.path,
          });
        });
        invoke.onError?.forEach((transition) => {
          targets.push({
            config: transition,
            fromPath: stateNode.path,
          });
        });
      });
      stateNode.ast.always?.forEach((transition) => {
        targets.push({
          config: transition,
          fromPath: stateNode.path,
        });
      });
    });

    return targets;
  };

  getTransitionTargets = () => {
    return this.getTransitions()
      .map((transition) => ({
        target: transition.config?.target,
        fromPath: transition.fromPath,
      }))
      .filter((transition) => Boolean(transition.target)) as {
      fromPath: string[];
      target: StringLiteralNode;
    }[];
  };

  getStateNodeByPath = (path: string[]) => {
    return this.stateNodes.find((node) => {
      return node.path.join("") === path.join("");
    });
  };

  getAllStateNodes = () => this.stateNodes;

  toConfig = () => {
    return toMachineConfig(this.ast);
  };

  getAllNamedConds = () => {
    const conds: Record<
      string,
      { node: t.Node; cond: Condition<any, any>; statePath: string[] }[]
    > = {};

    this.getTransitions().forEach((transition) => {
      if (transition.config?.cond?.name) {
        if (!conds[transition.config.cond.name]) {
          conds[transition.config.cond.name] = [];
        }
        conds[transition.config.cond.name].push({
          node: transition.config.cond.node,
          cond: transition.config.cond.cond,
          statePath: transition.fromPath,
        });
      }
    });

    return conds;
  };

  getAllNamedActions = () => {
    const actions = new RecordOfArrays<{
      node: t.Node;
      action: Action<any, any>;
      statePath: string[];
    }>();

    const addActionIfHasName = (action: ActionNode, statePath: string[]) => {
      if (action.name) {
        actions.add(action.name, {
          node: action.node,
          action: action.action,
          statePath,
        });
      }
    };

    this.getTransitions().forEach((transition) => {
      transition.config?.actions?.forEach((action) =>
        addActionIfHasName(action, transition.fromPath),
      );
    });

    this.getAllStateNodes().forEach((node) => {
      node.ast.entry?.forEach((action) => {
        addActionIfHasName(action, node.path);
      });
      node.ast.onEntry?.forEach((action) => {
        addActionIfHasName(action, node.path);
      });
      node.ast.exit?.forEach((action) => {
        addActionIfHasName(action, node.path);
      });
      node.ast.onExit?.forEach((action) => {
        addActionIfHasName(action, node.path);
      });
    });

    return actions.toObject();
  };

  getAllNamedServices = () => {
    const services: Record<
      string,
      { node: t.Node; name: string; statePath: string[]; srcNode?: t.Node }[]
    > = {};

    this.stateNodes.map((stateNode) => {
      stateNode.ast.invoke?.forEach((invoke) => {
        const invokeName =
          typeof invoke.src?.value === "string" ? invoke.src.value : undefined;
        if (invokeName) {
          if (!services[invokeName]) {
            services[invokeName] = [];
          }

          services[invokeName].push({
            name: invokeName,
            node: invoke.node,
            statePath: stateNode.path,
            srcNode: invoke.src?.node,
          });
        }
      });
    });

    return services;
  };

  getAllNamedDelays = () => {
    const delays = new RecordOfArrays<{
      node: t.Node;
      name: string;
      statePath: string[];
    }>();

    this.stateNodes.map((stateNode) => {
      stateNode.ast.after?.properties.forEach((property) => {
        if (t.isIdentifier(property.keyNode)) {
          const key = property.key;

          delays.add(key, {
            node: property.keyNode,
            name: key,
            statePath: stateNode.path,
          });
        }
      });
    });

    return delays.toObject();
  };

  getActionImplementation = (name: string) => {
    const node = this.ast?.options?.actions?.properties.find((property) => {
      return property.key === name;
    });

    return node;
  };

  getServiceImplementation = (name: string) => {
    const node = this.ast?.options?.services?.properties.find((property) => {
      return property.key === name;
    });

    return node;
  };

  getGuardImplementation = (name: string) => {
    const node = this.ast?.options?.guards?.properties.find((property) => {
      return property.key === name;
    });

    return node;
  };
}

class RecordOfArrays<T> {
  private map: Record<string, T[]> = {};

  add = (key: string, value: T) => {
    if (!this.map[key]) {
      this.map[key] = [];
    }
    this.map[key].push(value);
  };

  toObject = () => this.map;
}
