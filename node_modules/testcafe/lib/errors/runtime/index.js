"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkipJsErrorsArgumentApiError = exports.RequestRuntimeError = exports.BrowserConnectionError = exports.TimeoutError = exports.ReporterPluginError = exports.CompositeError = exports.ClientFunctionAPIError = exports.APIError = exports.TestCompilationError = exports.GeneralError = void 0;
const templates_1 = __importDefault(require("./templates"));
const create_stack_filter_1 = __importDefault(require("../create-stack-filter"));
const get_callsite_1 = require("../get-callsite");
const render_template_1 = __importDefault(require("../../utils/render-template"));
const render_callsite_sync_1 = __importDefault(require("../../utils/render-callsite-sync"));
const types_1 = require("../types");
const get_renderes_1 = __importDefault(require("../../utils/get-renderes"));
const util_1 = __importDefault(require("util"));
const ERROR_SEPARATOR = '\n\n';
class ProcessTemplateInstruction {
    constructor(processFn) {
        this.processFn = processFn;
    }
}
// Errors
class GeneralError extends Error {
    constructor(...args) {
        const code = args.shift();
        const template = templates_1.default[code];
        super((0, render_template_1.default)(template, ...args));
        Object.assign(this, { code, data: args });
        Error.captureStackTrace(this, GeneralError);
    }
    static isGeneralError(arg) {
        return arg instanceof GeneralError;
    }
}
exports.GeneralError = GeneralError;
class TestCompilationError extends Error {
    constructor(originalError) {
        const template = templates_1.default[types_1.RUNTIME_ERRORS.cannotPrepareTestsDueToError];
        const errorMessage = originalError.toString();
        super((0, render_template_1.default)(template, errorMessage));
        Object.assign(this, {
            code: types_1.RUNTIME_ERRORS.cannotPrepareTestsDueToError,
            data: [errorMessage],
        });
        // NOTE: stack includes message as well.
        this.stack = (0, render_template_1.default)(template, originalError.stack);
    }
}
exports.TestCompilationError = TestCompilationError;
class APIError extends Error {
    constructor(callsite, code, ...args) {
        let template = templates_1.default[code];
        template = APIError._prepareTemplateAndArgsIfNecessary(template, args);
        const rawMessage = (0, render_template_1.default)(template, ...args);
        super((0, render_template_1.default)(templates_1.default[types_1.RUNTIME_ERRORS.cannotPrepareTestsDueToError], rawMessage));
        Object.assign(this, { code, data: args });
        // NOTE: `rawMessage` is used in error substitution if it occurs in test run.
        this.rawMessage = rawMessage;
        if (typeof callsite === 'object')
            this.callsite = callsite;
        else
            this.callsite = (0, get_callsite_1.getCallsiteForMethod)(callsite);
        // NOTE: We need property getters here because callsite can be replaced by an external code.
        // See https://github.com/DevExpress/testcafe/blob/v1.0.0/src/compiler/test-file/formats/raw.js#L22
        // Also we can't use an ES6 getter for the 'stack' property, because it will create a getter on the class prototype
        // that cannot override the instance property created by the Error parent class.
        const renderers = (0, get_renderes_1.default)(this.callsite);
        Object.defineProperties(this, {
            'stack': {
                get: () => this._createStack(renderers.noColor),
            },
            'coloredStack': {
                get: () => this._createStack(renderers.default),
            },
        });
    }
    _createStack(renderer) {
        const renderedCallsite = (0, render_callsite_sync_1.default)(this.callsite, {
            renderer: renderer,
            stackFilter: (0, create_stack_filter_1.default)(Error.stackTraceLimit),
        });
        if (!renderedCallsite)
            return this.message;
        return this.message + ERROR_SEPARATOR + renderedCallsite;
    }
    static _prepareTemplateAndArgsIfNecessary(template, args) {
        const lastArg = args.pop();
        if (lastArg instanceof ProcessTemplateInstruction)
            template = lastArg.processFn(template);
        else
            args.push(lastArg);
        return template;
    }
}
exports.APIError = APIError;
class ClientFunctionAPIError extends APIError {
    constructor(methodName, instantiationCallsiteName, code, ...args) {
        args.push(new ProcessTemplateInstruction(template => template.replace(/\{#instantiationCallsiteName\}/g, instantiationCallsiteName)));
        super(methodName, code, ...args);
    }
}
exports.ClientFunctionAPIError = ClientFunctionAPIError;
class CompositeError extends Error {
    constructor(errors) {
        super(errors.map(({ message }) => message).join(ERROR_SEPARATOR));
        this.stack = errors.map(({ stack }) => stack).join(ERROR_SEPARATOR);
        this.code = types_1.RUNTIME_ERRORS.compositeArgumentsError;
    }
}
exports.CompositeError = CompositeError;
class ReporterPluginError extends GeneralError {
    constructor({ name, method, originalError }) {
        const code = types_1.RUNTIME_ERRORS.uncaughtErrorInReporter;
        const preparedStack = ReporterPluginError._prepareStack(originalError);
        super(code, method, name, preparedStack);
    }
    static _prepareStack(err) {
        if (!(err === null || err === void 0 ? void 0 : err.stack)) {
            const inspectedObject = util_1.default.inspect(err);
            return `No stack trace is available for a raised error.\nRaised error object inspection:\n${inspectedObject}`;
        }
        return err.stack;
    }
}
exports.ReporterPluginError = ReporterPluginError;
class TimeoutError extends GeneralError {
    constructor() {
        super(types_1.RUNTIME_ERRORS.timeLimitedPromiseTimeoutExpired);
    }
}
exports.TimeoutError = TimeoutError;
class BrowserConnectionError extends GeneralError {
    constructor(...args) {
        super(types_1.RUNTIME_ERRORS.browserConnectionError, ...args);
    }
}
exports.BrowserConnectionError = BrowserConnectionError;
class RequestRuntimeError extends APIError {
    constructor(methodName, code, ...args) {
        super(methodName, code, ...args);
    }
}
exports.RequestRuntimeError = RequestRuntimeError;
class SkipJsErrorsArgumentApiError extends APIError {
    constructor(code, ...args) {
        super('skipJsErrors', code, ...args);
    }
}
exports.SkipJsErrorsArgumentApiError = SkipJsErrorsArgumentApiError;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZXJyb3JzL3J1bnRpbWUvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsNERBQW9DO0FBQ3BDLGlGQUF1RDtBQUN2RCxrREFBdUQ7QUFDdkQsa0ZBQXlEO0FBQ3pELDRGQUFrRTtBQUNsRSxvQ0FBMEM7QUFDMUMsNEVBQW9EO0FBQ3BELGdEQUF3QjtBQUV4QixNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUM7QUFFL0IsTUFBTSwwQkFBMEI7SUFDNUIsWUFBYSxTQUFTO1FBQ2xCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0lBQy9CLENBQUM7Q0FDSjtBQUVELFNBQVM7QUFDVCxNQUFhLFlBQWEsU0FBUSxLQUFLO0lBQ25DLFlBQWEsR0FBRyxJQUFJO1FBQ2hCLE1BQU0sSUFBSSxHQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUM5QixNQUFNLFFBQVEsR0FBRyxtQkFBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRWpDLEtBQUssQ0FBQyxJQUFBLHlCQUFjLEVBQUMsUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUV6QyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFRCxNQUFNLENBQUMsY0FBYyxDQUFFLEdBQUc7UUFDdEIsT0FBTyxHQUFHLFlBQVksWUFBWSxDQUFDO0lBQ3ZDLENBQUM7Q0FDSjtBQWRELG9DQWNDO0FBRUQsTUFBYSxvQkFBcUIsU0FBUSxLQUFLO0lBQzNDLFlBQWEsYUFBYTtRQUN0QixNQUFNLFFBQVEsR0FBTyxtQkFBUyxDQUFDLHNCQUFjLENBQUMsNEJBQTRCLENBQUMsQ0FBQztR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YSxDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUVELE1BQU0sQ0FBQyxhQUFhLENBQUUsR0FBRztRQUNyQixJQUFJLENBQUMsQ0FBQSxHQUFHLGFBQUgsR0FBRyx1QkFBSCxHQUFHLENBQUUsS0FBSyxDQUFBLEVBQUU7WUFDYixNQUFNLGVBQWUsR0FBRyxjQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRTFDLE9BQU8scUZBQXFGLGVBQWUsRUFBRSxDQUFDO1NBQ2pIO1FBRUQsT0FBTyxHQUFHLENBQUMsS0FBSyxDQUFDO0lBQ3JCLENBQUM7Q0FFSjtBQWxCRCxrREFrQkM7QUFFRCxNQUFhLFlBQWEsU0FBUSxZQUFZO0lBQzFDO1FBQ0ksS0FBSyxDQUFDLHNCQUFjLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0NBQ0o7QUFKRCxvQ0FJQztBQUVELE1BQWEsc0JBQXVCLFNBQVEsWUFBWTtJQUNwRCxZQUFhLEdBQUcsSUFBSTtRQUNoQixLQUFLLENBQUMsc0JBQWMsQ0FBQyxzQkFBc0IsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO0lBQzFELENBQUM7Q0FDSjtBQUpELHdEQUlDO0FBRUQsTUFBYSxtQkFBb0IsU0FBUSxRQUFRO0lBQzdDLFlBQWEsVUFBVSxFQUFFLElBQUksRUFBRSxHQUFHLElBQUk7UUFDbEMsS0FBSyxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztJQUNyQyxDQUFDO0NBQ0o7QUFKRCxrREFJQztBQUVELE1BQWEsNEJBQTZCLFNBQVEsUUFBUTtJQUN0RCxZQUFhLElBQUksRUFBRSxHQUFHLElBQUk7UUFDdEIsS0FBSyxDQUFDLGNBQWMsRUFBRSxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztJQUN6QyxDQUFDO0NBQ0o7QUFKRCxvRUFJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBURU1QTEFURVMgZnJvbSAnLi90ZW1wbGF0ZXMnO1xuaW1wb3J0IGNyZWF0ZVN0YWNrRmlsdGVyIGZyb20gJy4uL2NyZWF0ZS1zdGFjay1maWx0ZXInO1xuaW1wb3J0IHsgZ2V0Q2FsbHNpdGVGb3JNZXRob2QgfSBmcm9tICcuLi9nZXQtY2FsbHNpdGUnO1xuaW1wb3J0IHJlbmRlclRlbXBsYXRlIGZyb20gJy4uLy4uL3V0aWxzL3JlbmRlci10ZW1wbGF0ZSc7XG5pbXBvcnQgcmVuZGVyQ2FsbHNpdGVTeW5jIGZyb20gJy4uLy4uL3V0aWxzL3JlbmRlci1jYWxsc2l0ZS1zeW5jJztcbmltcG9ydCB7IFJVTlRJTUVfRVJST1JTIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IGdldFJlbmRlcmVycyBmcm9tICcuLi8uLi91dGlscy9nZXQtcmVuZGVyZXMnO1xuaW1wb3J0IHV0aWwgZnJvbSAndXRpbCc7XG5cbmNvbnN0IEVSUk9SX1NFUEFSQVRPUiA9ICdcXG5cXG4nO1xuXG5jbGFzcyBQcm9jZXNzVGVtcGxhdGVJbnN0cnVjdGlvbiB7XG4gICAgY29uc3RydWN0b3IgKHByb2Nlc3NGbikge1xuICAgICAgICB0aGlzLnByb2Nlc3NGbiA9IHByb2Nlc3NGbjtcbiAgICB9XG59XG5cbi8vIEVycm9yc1xuZXhwb3J0IGNsYXNzIEdlbmVyYWxFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBjb25zdHJ1Y3RvciAoLi4uYXJncykge1xuICAgICAgICBjb25zdCBjb2RlICAgICA9IGFyZ3Muc2hpZnQoKTtcbiAgICAgICAgY29uc3QgdGVtcGxhdGUgPSBURU1QTEFURVNbY29kZV07XG5cbiAgICAgICAgc3VwZXIocmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIC4uLmFyZ3MpKTtcblxuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIHsgY29kZSwgZGF0YTogYXJncyB9KTtcbiAgICAgICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgR2VuZXJhbEVycm9yKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgaXNHZW5lcmFsRXJyb3IgKGFyZykge1xuICAgICAgICByZXR1cm4gYXJnIGluc3RhbmNlb2YgR2VuZXJhbEVycm9yO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIFRlc3RDb21waWxhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yIChvcmlnaW5hbEVycm9yKSB7XG4gICAgICAgIGNvbnN0IHRlbXBsYXRlICAgICA9IFRFTVBMQVRFU1tSVU5USU1FX0VSUk9SUy5jYW5ub3RQcmVwYXJlVGVzdHNEdWVUb0Vycm9yXTtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gb3JpZ2luYWxFcnJvci50b1N0cmluZygpO1xuXG4gICAgICAgIHN1cGVyKHJlbmRlclRlbXBsYXRlKHRlbXBsYXRlLCBlcnJvck1lc3NhZ2UpKTtcblxuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIHtcbiAgICAgICAgICAgIGNvZGU6IFJVTlRJTUVfRVJST1JTLmNhbm5vdFByZXBhcmVUZXN0c0R1ZVRvRXJyb3IsXG4gICAgICAgICAgICBkYXRhOiBbZXJyb3JNZXNzYWdlXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTk9URTogc3RhY2sgaW5jbHVkZXMgbWVzc2FnZSBhcyB3ZWxsLlxuICAgICAgICB0aGlzLnN0YWNrID0gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIG9yaWdpbmFsRXJyb3Iuc3RhY2spO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIEFQSUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yIChjYWxsc2l0ZSwgY29kZSwgLi4uYXJncykge1xuICAgICAgICBsZXQgdGVtcGxhdGUgPSBURU1QTEFURVNbY29kZV07XG5cbiAgICAgICAgdGVtcGxhdGUgPSBBUElFcnJvci5fcHJlcGFyZVRlbXBsYXRlQW5kQXJnc0lmTmVjZXNzYXJ5KHRlbXBsYXRlLCBhcmdzKTtcblxuICAgICAgICBjb25zdCByYXdNZXNzYWdlID0gcmVuZGVyVGVtcGxhdGUodGVtcGxhdGUsIC4uLmFyZ3MpO1xuXG4gICAgICAgIHN1cGVyKHJlbmRlclRlbXBsYXRlKFRFTVBMQVRFU1tSVU5USU1FX0VSUk9SUy5jYW5ub3RQcmVwYXJlVGVzdHNEdWVUb0Vycm9yXSwgcmF3TWVzc2FnZSkpO1xuXG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgeyBjb2RlLCBkYXRhOiBhcmdzIH0pO1xuXG4gICAgICAgIC8vIE5PVEU6IGByYXdNZXNzYWdlYCBpcyB1c2VkIGluIGVycm9yIHN1YnN0aXR1dGlvbiBpZiBpdCBvY2N1cnMgaW4gdGVzdCBydW4uXG4gICAgICAgIHRoaXMucmF3TWVzc2FnZSA9IHJhd01lc3NhZ2U7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsc2l0ZSA9PT0gJ29iamVjdCcpXG4gICAgICAgICAgICB0aGlzLmNhbGxzaXRlID0gY2FsbHNpdGU7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIHRoaXMuY2FsbHNpdGUgICA9IGdldENhbGxzaXRlRm9yTWV0aG9kKGNhbGxzaXRlKTtcblxuICAgICAgICAvLyBOT1RFOiBXZSBuZWVkIHByb3BlcnR5IGdldHRlcnMgaGVyZSBiZWNhdXNlIGNhbGxzaXRlIGNhbiBiZSByZXBsYWNlZCBieSBhbiBleHRlcm5hbCBjb2RlLlxuICAgICAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL0RldkV4cHJlc3MvdGVzdGNhZmUvYmxvYi92MS4wLjAvc3JjL2NvbXBpbGVyL3Rlc3QtZmlsZS9mb3JtYXRzL3Jhdy5qcyNMMjJcbiAgICAgICAgLy8gQWxzbyB3ZSBjYW4ndCB1c2UgYW4gRVM2IGdldHRlciBmb3IgdGhlICdzdGFjaycgcHJvcGVydHksIGJlY2F1c2UgaXQgd2lsbCBjcmVhdGUgYSBnZXR0ZXIgb24gdGhlIGNsYXNzIHByb3RvdHlwZVxuICAgICAgICAvLyB0aGF0IGNhbm5vdCBvdmVycmlkZSB0aGUgaW5zdGFuY2UgcHJvcGVydHkgY3JlYXRlZCBieSB0aGUgRXJyb3IgcGFyZW50IGNsYXNzLlxuICAgICAgICBjb25zdCByZW5kZXJlcnMgPSBnZXRSZW5kZXJlcnModGhpcy5jYWxsc2l0ZSk7XG5cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgICAgICAgICAgJ3N0YWNrJzoge1xuICAgICAgICAgICAgICAgIGdldDogKCkgPT4gdGhpcy5fY3JlYXRlU3RhY2socmVuZGVyZXJzLm5vQ29sb3IpLFxuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgJ2NvbG9yZWRTdGFjayc6IHtcbiAgICAgICAgICAgICAgICBnZXQ6ICgpID0+IHRoaXMuX2NyZWF0ZVN0YWNrKHJlbmRlcmVycy5kZWZhdWx0KSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9jcmVhdGVTdGFjayAocmVuZGVyZXIpIHtcbiAgICAgICAgY29uc3QgcmVuZGVyZWRDYWxsc2l0ZSA9IHJlbmRlckNhbGxzaXRlU3luYyh0aGlzLmNhbGxzaXRlLCB7XG4gICAgICAgICAgICByZW5kZXJlcjogICAgcmVuZGVyZXIsXG4gICAgICAgICAgICBzdGFja0ZpbHRlcjogY3JlYXRlU3RhY2tGaWx0ZXIoRXJyb3Iuc3RhY2tUcmFjZUxpbWl0KSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFyZW5kZXJlZENhbGxzaXRlKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMubWVzc2FnZTtcblxuICAgICAgICByZXR1cm4gdGhpcy5tZXNzYWdlICsgRVJST1JfU0VQQVJBVE9SICsgcmVuZGVyZWRDYWxsc2l0ZTtcbiAgICB9XG5cbiAgICBzdGF0aWMgX3ByZXBhcmVUZW1wbGF0ZUFuZEFyZ3NJZk5lY2Vzc2FyeSAodGVtcGxhdGUsIGFyZ3MpIHtcbiAgICAgICAgY29uc3QgbGFzdEFyZyA9IGFyZ3MucG9wKCk7XG5cbiAgICAgICAgaWYgKGxhc3RBcmcgaW5zdGFuY2VvZiBQcm9jZXNzVGVtcGxhdGVJbnN0cnVjdGlvbilcbiAgICAgICAgICAgIHRlbXBsYXRlID0gbGFzdEFyZy5wcm9jZXNzRm4odGVtcGxhdGUpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBhcmdzLnB1c2gobGFzdEFyZyk7XG5cbiAgICAgICAgcmV0dXJuIHRlbXBsYXRlO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIENsaWVudEZ1bmN0aW9uQVBJRXJyb3IgZXh0ZW5kcyBBUElFcnJvciB7XG4gICAgY29uc3RydWN0b3IgKG1ldGhvZE5hbWUsIGluc3RhbnRpYXRpb25DYWxsc2l0ZU5hbWUsIGNvZGUsIC4uLmFyZ3MpIHtcbiAgICAgICAgYXJncy5wdXNoKG5ldyBQcm9jZXNzVGVtcGxhdGVJbnN0cnVjdGlvbih0ZW1wbGF0ZSA9PiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXHsjaW5zdGFudGlhdGlvbkNhbGxzaXRlTmFtZVxcfS9nLCBpbnN0YW50aWF0aW9uQ2FsbHNpdGVOYW1lKSkpO1xuXG4gICAgICAgIHN1cGVyKG1ldGhvZE5hbWUsIGNvZGUsIC4uLmFyZ3MpO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvbXBvc2l0ZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yIChlcnJvcnMpIHtcbiAgICAgICAgc3VwZXIoZXJyb3JzLm1hcCgoeyBtZXNzYWdlIH0pID0+IG1lc3NhZ2UpLmpvaW4oRVJST1JfU0VQQVJBVE9SKSk7XG5cbiAgICAgICAgdGhpcy5zdGFjayA9IGVycm9ycy5tYXAoKHsgc3RhY2sgfSkgPT4gc3RhY2spLmpvaW4oRVJST1JfU0VQQVJBVE9SKTtcbiAgICAgICAgdGhpcy5jb2RlICA9IFJVTlRJTUVfRVJST1JTLmNvbXBvc2l0ZUFyZ3VtZW50c0Vycm9yO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIFJlcG9ydGVyUGx1Z2luRXJyb3IgZXh0ZW5kcyBHZW5lcmFsRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yICh7IG5hbWUsIG1ldGhvZCwgb3JpZ2luYWxFcnJvciB9KSB7XG4gICAgICAgIGNvbnN0IGNvZGUgICAgICAgICAgPSBSVU5USU1FX0VSUk9SUy51bmNhdWdodEVycm9ySW5SZXBvcnRlcjtcbiAgICAgICAgY29uc3QgcHJlcGFyZWRTdGFjayA9IFJlcG9ydGVyUGx1Z2luRXJyb3IuX3ByZXBhcmVTdGFjayhvcmlnaW5hbEVycm9yKTtcblxuICAgICAgICBzdXBlcihjb2RlLCBtZXRob2QsIG5hbWUsIHByZXBhcmVkU3RhY2spO1xuICAgIH1cblxuICAgIHN0YXRpYyBfcHJlcGFyZVN0YWNrIChlcnIpIHtcbiAgICAgICAgaWYgKCFlcnI/LnN0YWNrKSB7XG4gICAgICAgICAgICBjb25zdCBpbnNwZWN0ZWRPYmplY3QgPSB1dGlsLmluc3BlY3QoZXJyKTtcblxuICAgICAgICAgICAgcmV0dXJuIGBObyBzdGFjayB0cmFjZSBpcyBhdmFpbGFibGUgZm9yIGEgcmFpc2VkIGVycm9yLlxcblJhaXNlZCBlcnJvciBvYmplY3QgaW5zcGVjdGlvbjpcXG4ke2luc3BlY3RlZE9iamVjdH1gO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVyci5zdGFjaztcbiAgICB9XG5cbn1cblxuZXhwb3J0IGNsYXNzIFRpbWVvdXRFcnJvciBleHRlbmRzIEdlbmVyYWxFcnJvciB7XG4gICAgY29uc3RydWN0b3IgKCkge1xuICAgICAgICBzdXBlcihSVU5USU1FX0VSUk9SUy50aW1lTGltaXRlZFByb21pc2VUaW1lb3V0RXhwaXJlZCk7XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgQnJvd3NlckNvbm5lY3Rpb25FcnJvciBleHRlbmRzIEdlbmVyYWxFcnJvciB7XG4gICAgY29uc3RydWN0b3IgKC4uLmFyZ3MpIHtcbiAgICAgICAgc3VwZXIoUlVOVElNRV9FUlJPUlMuYnJvd3NlckNvbm5lY3Rpb25FcnJvciwgLi4uYXJncyk7XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgUmVxdWVzdFJ1bnRpbWVFcnJvciBleHRlbmRzIEFQSUVycm9yIHtcbiAgICBjb25zdHJ1Y3RvciAobWV0aG9kTmFtZSwgY29kZSwgLi4uYXJncykge1xuICAgICAgICBzdXBlcihtZXRob2ROYW1lLCBjb2RlLCAuLi5hcmdzKTtcbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBTa2lwSnNFcnJvcnNBcmd1bWVudEFwaUVycm9yIGV4dGVuZHMgQVBJRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yIChjb2RlLCAuLi5hcmdzKSB7XG4gICAgICAgIHN1cGVyKCdza2lwSnNFcnJvcnMnLCBjb2RlLCAuLi5hcmdzKTtcbiAgICB9XG59XG4iXX0=