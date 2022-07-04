
import * as vscode from "vscode";

type Context = {
	readonly i: number;
	readonly index: number;
	readonly s: number;
	readonly line: number;
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
};

let AsyncFunction = Object.getPrototypeOf(new Function("return async function () { }")()).constructor;

function registerCommand(context: vscode.ExtensionContext, command: string, fn: () => void) {
	let cmd = vscode.commands.registerCommand(command, fn);
	context.subscriptions.push(cmd);
	return cmd;
}

function* selections(editor: vscode.TextEditor) {
	for (let i = 0; i < editor.selections.length; i += 1) {
		yield editor.selections[i];
	}
}

export function activate(context: vscode.ExtensionContext) {
	let lastPath: string | undefined = undefined;
	let executor: {
		process: (text: string, context: Context) => (() => string | undefined) | (() => Promise<string | undefined>);
		augment: (context: Context) => void;
	} | undefined;

	registerCommand(context, "transformer.reloadExecutor", () => {
		let executorPath = vscode.workspace.getConfiguration().get<string | null>("text-transformer.executor");
		if (executorPath != null) {
			delete require.cache[require.resolve(executorPath)];
			try {
				executor = require(executorPath);
				lastPath = executorPath;
				if (executor && typeof (executor.process) !== "function") {
					vscode.window.showErrorMessage(`Failed to load executor, reason: process function not found`);
					executor = undefined;
				} else {
					vscode.window.showInformationMessage("Reloaded executor");
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to load executor, reason: ` + err);
				executor = undefined;
			}
		};
	});
	registerCommand(context, "transformer.inlineEval", async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor !== undefined) {
			let executorPath = vscode.workspace.getConfiguration().get<string | null>("text-transformer.executor");
			if (executorPath != null) {
				console.log(`executorPath ${executorPath}`);
				if (lastPath !== undefined) {
					// unload last path
					try { delete require.cache[require.resolve(lastPath)]; } catch (err) { }
				}
				if (lastPath !== executorPath) {
					try {
						console.log(`Loading executor from ${executorPath}`);
						executor = require(executorPath);
						if (executor && typeof (executor.process) !== "function") {
							executor = undefined;
						}
					} catch (err) {
						vscode.window.showErrorMessage(`Failed to load executor, reason: ` + err);
						executor = undefined;
					}
					lastPath = executorPath;
				}
			} else {
				executor = undefined;
			}

			let s = 0;
			let i = 0;
			let selection: vscode.Selection;
			const context = {
				get i() { return i; },
				get index() { return i + 1; },
				get s() { return s; },
				get line() { return selection.start.line + 1; },
				get startLine() { return selection.start.line; },
				get startCharacter() { return selection.start.character; },
				get endLine() { return selection.end.line; },
				get endCharacter() { return selection.end.character; }
			};

			if (executor !== undefined && typeof (executor.augment) === "function") {
				executor.augment(context);
			}


			let replacements: { selection: vscode.Selection; result: any }[] = [];
			let errored = false;

			if (executor !== undefined) {
				let hasAsync = false;
				// gather all replacement functions, figure out if we have any AsyncFunctions
				for (selection of selections(editor)) {
					try {
						const currentText = editor.document.getText(selection);
						let result: ((context: Context) => Promise<string | undefined>) | ((context: Context) => string | undefined);
						result = executor.process(currentText, context);
						if (result instanceof AsyncFunction) {
							hasAsync = true;
						} else if (result !== undefined && (result instanceof Function === false)) {
							vscode.window.showErrorMessage(`Failed to replace custom executor didn't return a function or undefined`);
							return;
						}
						replacements.push({ selection, result });
					} catch (err) {
						vscode.window.showErrorMessage(`Failed to replace at ${selection.start.line}:${selection.start.character}, reason: ` + err);
					}
				}

				if (hasAsync === false) {
					// no AsyncFunctions, we can execute everything directly
					for (let replacement of replacements) {
						selection = replacement.selection;
						let result = replacement.result;
						try {
							if (result !== undefined) {
								let value = result(context);
								if (value !== undefined) {
									if (typeof value === "object") {
										value = JSON.stringify(value);
									}
									i++;
								}
								replacement.result = "" + value;
							}
						} catch (err) {
							vscode.window.showErrorMessage(`Failed to replace at ${selection.start.line}:${selection.start.character}, reason: ` + err);
							errored = true;
						}
						s++;
					}
				} else {
					// we have AsyncFunctions, we need to execute each async function in order
					await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Finding ...', cancellable: false },
						async (progress) => {
							s = 0;
							i = 0;

							for (let replacement of replacements) {
								progress.report({ message: `Processing async executors [${i}/${replacements.length}]` });
								selection = replacement.selection;
								let result = replacement.result;
								if (result !== undefined) {
									try {
										let value = result !== undefined ? await result(context) : undefined;

										if (value !== undefined) {
											if (typeof value === "object") {
												value = JSON.stringify(value);
											}
											i++;
										}
										replacement.result = "" + value;
									} catch (err) {
										vscode.window.showErrorMessage(`Failed to replace at ${selection.start.line}:${selection.start.character}, reason: ` + err);
										errored = true;
									}
								}
								s++;
							}
							progress.report({ message: "Processing async executors [done]" });
						}
					)
				}
			} else {
				// default replacement rules
				for (selection of selections(editor)) {
					try {
						const currentText = editor.document.getText(selection);
						let result: any;
						if (currentText.length > 0) {
							result = new Function("$", "return " + currentText + ";")(context);
						}
						if (result !== undefined) {
							if (typeof result === "object") {
								result = JSON.stringify(result);
							}
							replacements.push({ selection, result: "" + result });
							i++;
						}
						s++;
					} catch (err) {
						vscode.window.showErrorMessage(`Failed to created replacement at ${selection.start.line}:${selection.start.character}, reason: ` + err);
						errored = true;
					}
				}
			}

			if (errored === false) {
				// at this point everything should be resolved, if there we no error replace all selection
				await editor.edit((edit) => {
					// validate that selections didn't change
					let newSelections = [...selections(editor)];
					for (let i = 0; i < replacements.length; i++) {
						if (replacements[i].selection !== newSelections[i]) {
							vscode.window.showErrorMessage(`Failed to replace selection as it changed during async execution`);
							return;
						}
					}

					// replace each selection as long as the result is not undefined
					let result;
					for ({ selection, result } of replacements) {
						if (result !== undefined) {
							edit.replace(selection, result);
						}
					}
					return true;
				});
			}
		}
		return undefined;
	});

	registerCommand(context, "transformer.increment", () => {
		const editor = vscode.window.activeTextEditor;
		if (editor !== undefined) {
			return editor.edit((edit) => {
				for (const selection of selections(editor)) {
					try {
						const currentText = editor.document.getText(selection);
						const currentValue = parseInt(currentText, 10);
						if (currentText === "" + currentValue) { edit.replace(selection, "" + (currentValue + 1)); }
					} catch (err) {
						vscode.window.showErrorMessage(`Failed to increment at ${selection.start.line}:${selection.start.character}, reason: ` + err);
					}
				}
			});
		}
		return undefined;
	});

	registerCommand(context, "transformer.decrement", () => {
		const editor = vscode.window.activeTextEditor;
		if (editor !== undefined) {
			return editor.edit((edit) => {
				for (const selection of selections(editor)) {
					try {
						const currentText = editor.document.getText(selection);
						const currentValue = parseInt(currentText, 10);
						if (currentText === "" + currentValue) { edit.replace(selection, "" + (currentValue - 1)); }
					} catch (err) {
						vscode.window.showErrorMessage(`Failed to decrement at ${selection.start.line}:${selection.start.character}, reason: ` + err);
					}
				}
			});
		}
		return undefined;
	});
}

export function deactivate() { }
