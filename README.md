# Text Transformer (VS Code extension)

This extension provides advanced text transformation commands.

All of the commands start with `Transformer:` to make them easier to find

## Features

`Transformer: Evaluate selected as inline javascript (transformer.inlineEval)`
 > ⚠ **This command will execute the text as javascript, this includes potentially dangerous code.** ⚠
 >
 > ⚠ **This can crash the extension, vscode, or worse, as it executes text as code** ⚠

-  Transform all selected lines by evaluating them as javascript
-  Keybind: ctrl+alt+q e

`Transformer: Reload executor`

-  Reload the executor file
-  Keybind: ctrl+alt+q r

`Transformer: Increment all selected numbers by 1 (transformer.increment)`

-  Transform all selected numeric lines, increasing the number by 1
-  Keybind: ctrl+alt+numpad_add

`Transformer: Decrement all selected numbers by 1 (transformer.decrement)`

-  Transform all selected numeric lines, decreasing the number by 1
-  Keybind: ctrl+alt+numpad_subtract

# Custom Executor

A custom executor can be provides to customize the inline execution, you will need to provide the path of the executor
using the `"text-transformer.executor"` settings option.

**Custom executors need to define a `process` function that return either Function or AsyncFunction!**

**Custom executors will only receive the context when the function is executed!**

```json
{
	"text-transformer.executor": "<path_to_executor>/executor.js"
}
```

Custom executor file definition:

```ts
type Context = {
	// i and index only increments when the line is actually replaced
	readonly i: number; // index of the replaced value, starting at 0
	readonly index: number; // i + 1
	readonly s: number; // selection index, starting at 0
	readonly line: number; // starting line of the selection, start at 1
	readonly startLine: number; // starting line of the selection, 0 based
	readonly startCharacter: number; // starting character number of the selection, 0 based
	readonly endLine: number; // ending line of the selection, 0 based
	readonly endCharacter: number; // ending character number of the selection, 0 based
};

/** Process has to return either a Function, AsyncFunction or undefined */
export function process(
	text: string
): ((context: Context) => string | undefined) | ((context: Context) => Promise<string | undefined>) | undefined;
```

Default executor

```js
exports.process = function process(text) {
	if (text.length > 0) {
		return new Function("$", "return " + text + ";");
	}
	return undefined;
};
```

---

## Injecting the context using `with`

By default the context is available under the `$` variable, for example to access `i` you would use `$.i`

If you want to inject the context as variables that are directly accessible you can use `with($)` within the generated function

```js
exports.process = function process(text) {
	if (text.length > 0) {
		return new Function("$", "with($) return " + text + ";");
	}
	return undefined;
};
```

# [Optional] Custom context augment

Defining an exported augment function will allow you to augment the context.

This function runs once when you execute the command instead of once per selection.

Example of attaching an instance of an object to the context

```js
class Context {
	fromEntries(array) {
		return Object.fromEntries(array);
	}
}

exports.augment = function augment(context) {
	Object.setPrototypeOf(context, new Context());
};

exports.process = function process(text) {
	if (text.length > 0) {
		return new Function("$", "return " + text + ";");
	}
	return undefined;
};
```

This example defines a method called fromEntries, `$.fromEntries([["a","b"], ["c","d"]])` will now turn into `{"a":"b","c":"d"}`

## [Optional] Custom context augment with async functions and context injection

> ⚠ **This is a heavily experimental feature** ⚠

Custom process function allows the return of AsyncFunction, this will allow the process function to become async and the
await keyword will function.

For async to work correctly the selection can't change while the async functions are executing, 
the command will re-check to make sure all of the selections are still the same.

AsyncFunction allow things like fetching an API or reading a file asynchronously.


```js
class Context {
	fromEntries(array) {
		return Object.fromEntries(array);
	}

	getJSON(url) {
		url = new URL(url);
		let http = require(url.protocol === "https:" ? "https" : "http");

		return new Promise((resolve, reject) => {
			let req = http.request(url, {
				method: "GET",
				timeout: 30 * 1000
			}, response => {
				try {
					if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
						try { req.destroy(); } catch (error) { }
						return reject(new Error("Invalid status code " + response.statusCode));
					}

					let data = "";
					response.on("data", chunk => { data += chunk; });
					response.on("end", () => {
						try {
							return resolve(JSON.parse(data));
						} catch (err) { reject(err); }
					});
				} catch (err) { reject(err); }
			});
			req.on("error", error => { return reject(error); });
			req.end();
		});
	}
}

exports.augment = function augment(context) {
	Object.setPrototypeOf(context, Context.prototype);
}

// get the AsyncFunction constructor
let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

exports.process = function process(text) {
	if (text.length > 0) {
		try {
			// attempt to return a normal function
			return new Function("$", "with($) return " + text + ";");
		} catch (err) {
			// using the keyword await will prevent the function from being created
			// if that happens attempt to create an async function
			return new AsyncFunction("$", "with($) return " + text + ";");
		}
	}
	return undefined;
}
```

Usage example of `getJSON`: 
```js
await getJSON("https://reqbin.com/echo/get/json") //-> {"success":"true"}
```

This setup also allow you to create a project locally with dependencies, it can even be a transpiled TypeScript project 
using for example `ts-node` (`swc` is recommend to speed up the compile times but not required), it is also possible to
compile the inlined code using TypeScript (again `swc` is recommended)

> This feature is provided as early access, a comprehensive Custom Executor example is in the work and will be available
> eventually, but if you have ideas on how you would like to extends the inline executor this will allow you do to so.
