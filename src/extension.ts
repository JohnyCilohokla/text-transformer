
import * as vscode from "vscode";

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

	registerCommand(context, "transformer.inlineEval", () => {
		const editor = vscode.window.activeTextEditor;
		if (editor !== undefined) {
			return editor.edit((edit) => {
				let i = 0;
				for (const selection of selections(editor)) {
					try {
						const currentText = editor.document.getText(selection);
						if (currentText.length > 0) {
							const result = (new Function("$", "return " + currentText + ";"))({
								i: i,
								index: i + 1,
								line: selection.start.line,
								startLine: selection.start.line,
								endLine: selection.end.line
							});
							if (typeof result === "object") {
								edit.replace(selection, JSON.stringify(result));
							} else {
								edit.replace(selection, "" + result);
							}
							i++;
						}
					} catch (err) { console.error(err); }
				}
			});
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
					} catch (err) { console.error(err); }
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
					} catch (err) { console.error(err); }
				}
			});
		}
		return undefined;
	});
}

export function deactivate() { }
