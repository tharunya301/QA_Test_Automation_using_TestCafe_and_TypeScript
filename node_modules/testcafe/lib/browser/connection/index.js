"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const time_limit_promise_1 = __importDefault(require("time-limit-promise"));
const events_1 = require("events");
const mustache_1 = __importDefault(require("mustache"));
const lodash_1 = require("lodash");
const parse_user_agent_1 = require("../../utils/parse-user-agent");
const read_file_relative_1 = require("read-file-relative");
const promisify_event_1 = __importDefault(require("promisify-event"));
const nanoid_1 = require("nanoid");
const command_1 = __importDefault(require("./command"));
const status_1 = __importDefault(require("./status"));
const heartbeat_status_1 = __importDefault(require("./heartbeat-status"));
const runtime_1 = require("../../errors/runtime");
const types_1 = require("../../errors/types");
const warning_log_1 = __importDefault(require("../../notifications/warning-log"));
const service_routes_1 = __importDefault(require("./service-routes"));
const browser_connection_timeouts_1 = require("../../utils/browser-connection-timeouts");
const tracker_1 = __importDefault(require("./tracker"));
const getBrowserConnectionDebugScope = (id) => `testcafe:browser:connection:${id}`;
const IDLE_PAGE_TEMPLATE = (0, read_file_relative_1.readSync)('../../client/browser/idle-page/index.html.mustache');
class BrowserConnection extends events_1.EventEmitter {
    constructor(gateway, browserInfo, permanent, disableMultipleWindows = false, proxyless = false, messageBus) {
        super();
        this._currentTestRun = null;
        this.url = '';
        this.idleUrl = '';
        this.forcedIdleUrl = '';
        this.initScriptUrl = '';
        this.heartbeatUrl = '';
        this.statusUrl = '';
        this.activeWindowIdUrl = '';
        this.closeWindowUrl = '';
        this.statusDoneUrl = '';
        this.heartbeatRelativeUrl = '';
        this.statusRelativeUrl = '';
        this.statusDoneRelativeUrl = '';
        this.idleRelativeUrl = '';
        this.openFileProtocolRelativeUrl = '';
        this.openFileProtocolUrl = '';
        this.osInfo = null;
        this.HEARTBEAT_TIMEOUT = browser_connection_timeouts_1.HEARTBEAT_TIMEOUT;
        this.BROWSER_CLOSE_TIMEOUT = browser_connection_timeouts_1.BROWSER_CLOSE_TIMEOUT;
        this.BROWSER_RESTART_TIMEOUT = browser_connection_timeouts_1.BROWSER_RESTART_TIMEOUT;
        this.id = BrowserConnection._generateId();
        this.jobQueue = [];
        this.initScriptsQueue = [];
        this.browserConnectionGateway = gateway;
        this.disconnectionPromise = null;
        this.testRunAborted = false;
        this.warningLog = new warning_log_1.default(null, warning_log_1.default.createAddWarningCallback(messageBus));
        this.debugLogger = (0, debug_1.default)(getBrowserConnectionDebugScope(this.id));
        if (messageBus)
            this.messageBus = messageBus;
        this.browserInfo = browserInfo;
        this.browserInfo.userAgentProviderMetaInfo = '';
        this.provider = browserInfo.provider;
        this.permanent = permanent;
        this.status = status_1.default.uninitialized;
        this.idle = true;
        this.heartbeatTimeout = null;
        this.pendingTestRunInfo = null;
        this.disableMultipleWindows = disableMultipleWindows;
        this.proxyless = proxyless;
        this._buildCommunicationUrls(gateway.proxy);
        this._setEventHandlers();
        tracker_1.default.add(this);
        this.previousActiveWindowId = null;
        this.browserConnectionGateway.startServingConnection(this);
        // NOTE: Give a caller time to assign event listeners
        process.nextTick(() => this._runBrowser());
    }
    _buildCommunicationUrls(proxy) {
        this.url = proxy.resolveRelativeServiceUrl(`${service_routes_1.default.connect}/${this.id}`);
        this.forcedIdleUrl = proxy.resolveRelativeServiceUrl(`${service_routes_1.default.idleForced}/${this.id}`);
        this.initScriptUrl = proxy.resolveRelativeServiceUrl(`${service_routes_1.default.initScript}/${this.id}`);
        this.heartbeatRelativeUrl = `${service_routes_1.default.heartbeat}/${this.id}`;
        this.statusRelativeUrl = `${service_routes_1.default.status}/${this.id}`;
        this.statusDoneRelativeUrl = `${service_routes_1.default.statusDone}/${this.id}`;
        this.idleRelativeUrl = `${service_routes_1.default.idle}/${this.id}`;
        this.activeWindowIdUrl = `${service_routes_1.default.activeWindowId}/${this.id}`;
        this.closeWindowUrl = `${service_routes_1.default.closeWindow}/${this.id}`;
        this.openFileProtocolRelativeUrl = `${service_routes_1.default.openFileProtocol}/${this.id}`;
        this.idleUrl = proxy.resolveRelativeServiceUrl(this.idleRelativeUrl);
        this.heartbeatUrl = proxy.resolveRelativeServiceUrl(this.heartbeatRelativeUrl);
        this.statusUrl = proxy.resolveRelativeServiceUrl(this.statusRelativeUrl);
        this.statusDoneUrl = proxy.resolveRelativeServiceUrl(this.statusDoneRelativeUrl);
        this.openFileProtocolUrl = proxy.resolveRelativeServiceUrl(this.openFileProtocolRelativeUrl);
    }
    set messageBus(messageBus) {
        this._messageBus = messageBus;
        this.warningLog.callback = warning_log_1.default.createAddWarningCallback(this._messageBus);
        if (messageBus) {
            messageBus.on('test-run-start', testRun => {
                if (testRun.browserConnection.id === this.id)
                    this._currentTestRun = testRun;
            });
        }
    }
    _setEventHandlers() {
        this.on('error', e => {
            this.debugLogger(e);
            this._forceIdle();
            this.close();
        });
        for (const name in status_1.default) {
            const status = status_1.default[name];
            this.on(status, () => {
                this.debugLogger(`status changed to '${status}'`);
            });
        }
    }
    static _generateId() {
        return (0, nanoid_1.nanoid)(7);
    }
    _getAdditionalBrowserOptions() {
        const options = {
            disableMultipleWindows: this.disableMultipleWindows,
        };
        if (this.proxyless) {
            options.proxyless = {
                serviceDomains: [
                    this.browserConnectionGateway.proxy.server1Info.domain,
                    this.browserConnectionGateway.proxy.server2Info.domain,
                ],
                developmentMode: this.browserConnectionGateway.proxy.options.developmentMode,
            };
        }
        return options;
    }
    async _runBrowser() {
        try {
            const additionalOptions = this._getAdditionalBrowserOptions();
            await this.provider.openBrowser(this.id, this.url, this.browserInfo.browserOption, additionalOptions);
            if (this.status !== status_1.default.ready)
                await (0, promisify_event_1.default)(this, 'ready');
            this.status = status_1.default.opened;
            this.emit('opened');
        }
        catch (err) {
            this.emit('error', new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.unableToOpenBrowser, this.browserInfo.providerName + ':' + this.browserInfo.browserName, err.stack));
        }
    }
    async _closeBrowser(data = {}) {
        if (!this.idle)
            await (0, promisify_event_1.default)(this, 'idle');
        try {
            await this.provider.closeBrowser(this.id, data);
        }
        catch (err) {
            // NOTE: A warning would be really nice here, but it can't be done while log is stored in a task.
            this.debugLogger(err);
        }
    }
    _forceIdle() {
        if (!this.idle) {
            this.idle = true;
            this.emit('idle');
        }
    }
    _createBrowserDisconnectedError() {
        return new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.browserDisconnected, this.userAgent);
    }
    _waitForHeartbeat() {
        this.heartbeatTimeout = setTimeout(() => {
            const err = this._createBrowserDisconnectedError();
            this.status = status_1.default.disconnected;
            this.testRunAborted = true;
            this.emit('disconnected', err);
            this._restartBrowserOnDisconnect(err);
        }, this.HEARTBEAT_TIMEOUT);
    }
    async _getTestRunInfo(needPopNext) {
        if (needPopNext || !this.pendingTestRunInfo)
            this.pendingTestRunInfo = await this._popNextTestRunInfo();
        return this.pendingTestRunInfo;
    }
    async _popNextTestRunInfo() {
        while (this.hasQueuedJobs && !this.currentJob.hasQueuedTestRuns)
            this.jobQueue.shift();
        return this.hasQueuedJobs ? await this.currentJob.popNextTestRunInfo(this) : null;
    }
    getCurrentTestRun() {
        return this._currentTestRun;
    }
    static getById(id) {
        return tracker_1.default.activeBrowserConnections[id] || null;
    }
    async _restartBrowser() {
        this.status = status_1.default.uninitialized;
        this._forceIdle();
        let resolveTimeout = null;
        let isTimeoutExpired = false;
        let timeout = null;
        const restartPromise = (0, time_limit_promise_1.default)(this._closeBrowser({ isRestarting: true }), this.BROWSER_CLOSE_TIMEOUT, { rejectWith: new runtime_1.TimeoutError() })
            .catch(err => this.debugLogger(err))
            .then(() => this._runBrowser());
        const timeoutPromise = new Promise(resolve => {
            resolveTimeout = resolve;
            timeout = setTimeout(() => {
                isTimeoutExpired = true;
                resolve();
            }, this.BROWSER_RESTART_TIMEOUT);
        });
        return Promise.race([restartPromise, timeoutPromise])
            .then(() => {
            clearTimeout(timeout);
            if (isTimeoutExpired)
                this.emit('error', this._createBrowserDisconnectedError());
            else
                resolveTimeout();
        });
    }
    _restartBrowserOnDisconnect(err) {
        let resolveFn = null;
        let rejectFn = null;
        this.disconnectionPromise = new Promise((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = () => {
                reject(err);
            };
            setTimeout(() => {
                rejectFn();
            });
        })
            .then(() => {
            return this._restartBrowser();
        })
            .catch(e => {
            this.emit('error', e);
        });
        this.disconnectionPromise.resolve = resolveFn;
        this.disconnectionPromise.reject = rejectFn;
    }
    async getDefaultBrowserInitTimeout() {
        const isLocalBrowser = await this.provider.isLocalBrowser(this.id, this.browserInfo.browserName);
        return isLocalBrowser ? browser_connection_timeouts_1.LOCAL_BROWSER_INIT_TIMEOUT : browser_connection_timeouts_1.REMOTE_BROWSER_INIT_TIMEOUT;
    }
    async processDisconnection(disconnectionThresholdExceeded) {
        const { resolve, reject } = this.disconnectionPromise;
        if (disconnectionThresholdExceeded)
            reject();
        else
            resolve();
    }
    addWarning(message, ...args) {
        if (this.currentJob)
            this.currentJob.warningLog.addWarning(message, ...args);
        else
            this.warningLog.addWarning(message, ...args);
    }
    _appendToPrettyUserAgent(str) {
        this.browserInfo.parsedUserAgent.prettyUserAgent += ` (${str})`;
    }
    _moveWarningLogToJob(job) {
        job.warningLog.copyFrom(this.warningLog);
        this.warningLog.clear();
    }
    setProviderMetaInfo(str, options) {
        const appendToUserAgent = options === null || options === void 0 ? void 0 : options.appendToUserAgent;
        if (appendToUserAgent) {
            // NOTE:
            // change prettyUserAgent only when connection already was established
            if (this.isReady())
                this._appendToPrettyUserAgent(str);
            else
                this.on('ready', () => this._appendToPrettyUserAgent(str));
            return;
        }
        this.browserInfo.userAgentProviderMetaInfo = str;
    }
    get userAgent() {
        let userAgent = this.browserInfo.parsedUserAgent.prettyUserAgent;
        if (this.browserInfo.userAgentProviderMetaInfo)
            userAgent += ` (${this.browserInfo.userAgentProviderMetaInfo})`;
        return userAgent;
    }
    get connectionInfo() {
        if (!this.osInfo)
            return this.userAgent;
        const { name, version } = this.browserInfo.parsedUserAgent;
        let connectionInfo = (0, parse_user_agent_1.calculatePrettyUserAgent)({ name, version }, this.osInfo);
        const metaInfo = this.browserInfo.userAgentProviderMetaInfo || (0, parse_user_agent_1.extractMetaInfo)(this.browserInfo.parsedUserAgent.prettyUserAgent);
        if (metaInfo)
            connectionInfo += ` (${metaInfo})`;
        return connectionInfo;
    }
    get retryTestPages() {
        return this.browserConnectionGateway.retryTestPages;
    }
    get hasQueuedJobs() {
        return !!this.jobQueue.length;
    }
    get currentJob() {
        return this.jobQueue[0];
    }
    // API
    runInitScript(code) {
        return new Promise(resolve => this.initScriptsQueue.push({ code, resolve }));
    }
    addJob(job) {
        this.jobQueue.push(job);
        this._moveWarningLogToJob(job);
    }
    removeJob(job) {
        (0, lodash_1.pull)(this.jobQueue, job);
    }
    async close() {
        if (this.status === status_1.default.closing || this.status === status_1.default.closed)
            return;
        this.status = status_1.default.closing;
        this.emit(status_1.default.closing);
        await this._closeBrowser();
        this.browserConnectionGateway.stopServingConnection(this);
        if (this.heartbeatTimeout)
            clearTimeout(this.heartbeatTimeout);
        tracker_1.default.remove(this);
        this.status = status_1.default.closed;
        this.emit(status_1.default.closed);
    }
    async establish(userAgent) {
        this.status = status_1.default.ready;
        this.browserInfo.parsedUserAgent = (0, parse_user_agent_1.parseUserAgent)(userAgent);
        this.osInfo = await this.provider.getOSInfo(this.id);
        this._waitForHeartbeat();
        this.emit('ready');
    }
    heartbeat() {
        if (this.heartbeatTimeout)
            clearTimeout(this.heartbeatTimeout);
        this._waitForHeartbeat();
        return {
            code: this.status === status_1.default.closing ? heartbeat_status_1.default.closing : heartbeat_status_1.default.ok,
            url: this.status === status_1.default.closing ? this.idleUrl : '',
        };
    }
    renderIdlePage() {
        return mustache_1.default.render(IDLE_PAGE_TEMPLATE, {
            userAgent: this.connectionInfo,
            statusUrl: this.statusUrl,
            heartbeatUrl: this.heartbeatUrl,
            initScriptUrl: this.initScriptUrl,
            openFileProtocolUrl: this.openFileProtocolUrl,
            retryTestPages: !!this.browserConnectionGateway.retryTestPages,
            proxyless: this.proxyless,
        });
    }
    getInitScript() {
        const initScriptPromise = this.initScriptsQueue[0];
        return { code: initScriptPromise ? initScriptPromise.code : null };
    }
    handleInitScriptResult(data) {
        const initScriptPromise = this.initScriptsQueue.shift();
        if (initScriptPromise)
            initScriptPromise.resolve(JSON.parse(data));
    }
    isHeadlessBrowser() {
        return this.provider.isHeadlessBrowser(this.id);
    }
    async reportJobResult(status, data) {
        await this.provider.reportJobResult(this.id, status, data);
    }
    async getStatus(isTestDone) {
        if (!this.idle && !isTestDone) {
            this.idle = true;
            this.emit('idle');
        }
        if (this.status === status_1.default.opened) {
            const nextTestRunInfo = await this._getTestRunInfo(isTestDone || this.testRunAborted);
            this.testRunAborted = false;
            if (nextTestRunInfo) {
                this.idle = false;
                return {
                    cmd: command_1.default.run,
                    testRunId: nextTestRunInfo.testRunId,
                    url: nextTestRunInfo.url,
                };
            }
        }
        return {
            cmd: command_1.default.idle,
            url: this.idleUrl,
            testRunId: null,
        };
    }
    get activeWindowId() {
        return this.provider.getActiveWindowId(this.id);
    }
    set activeWindowId(val) {
        this.previousActiveWindowId = this.activeWindowId;
        this.provider.setActiveWindowId(this.id, val);
    }
    async openFileProtocol(url) {
        return this.provider.openFileProtocol(this.id, url);
    }
    async canUseDefaultWindowActions() {
        return this.provider.canUseDefaultWindowActions(this.id);
    }
    isReady() {
        return this.status === status_1.default.ready ||
            this.status === status_1.default.opened ||
            this.status === status_1.default.closing;
    }
}
exports.default = BrowserConnection;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9jb25uZWN0aW9uL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsa0RBQTBCO0FBQzFCLDRFQUEyQztBQUMzQyxtQ0FBc0M7QUFDdEMsd0RBQWdDO0FBQ2hDLG1DQUF3QztBQUN4QyxtRUFLc0M7QUFDdEMsMkRBQXNEO0FBQ3RELHNFQUE2QztBQUM3QyxtQ0FBZ0M7QUFDaEMsd0RBQWdDO0FBQ2hDLHNEQUErQztBQUMvQywwRUFBaUQ7QUFDakQsa0RBQWtFO0FBQ2xFLDhDQUFvRDtBQUdwRCxrRkFBeUQ7QUFHekQsc0VBQThDO0FBQzlDLHlGQU1pRDtBQUVqRCx3REFBaUQ7QUFPakQsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLEVBQVUsRUFBVSxFQUFFLENBQUMsK0JBQStCLEVBQUUsRUFBRSxDQUFDO0FBRW5HLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSw2QkFBSSxFQUFDLG9EQUFvRCxDQUFDLENBQUM7QUE2Q3RGLE1BQXFCLGlCQUFrQixTQUFRLHFCQUFZO0lBNEN2RCxZQUNJLE9BQWlDLEVBQ2pDLFdBQXdCLEVBQ3hCLFNBQWtCLEVBQ2xCLHNCQUFzQixHQUFHLEtBQUssRUFDOUIsU0FBUyxHQUFHLEtBQUssRUFDakIsVUFBdUI7UUFDdkIsS0FBSyxFQUFFLENBQUM7UUExQ0osb0JBQWUsR0FBbUIsSUFBSSxDQUFDO1FBU3hDLFFBQUcsR0FBRyxFQUFFLENBQUM7UUFDVCxZQUFPLEdBQUcsRUFBRSxDQUFDO1FBQ1osa0JBQWEsR0FBRyxFQUFFLENBQUM7UUFDbkIsa0JBQWEsR0FBRyxFQUFFLENBQUM7UUFDcEIsaUJBQVksR0FBRyxFQUFFLENBQUM7UUFDbEIsY0FBUyxHQUFHLEVBQUUsQ0FBQztRQUNmLHNCQUFpQixHQUFHLEVBQUUsQ0FBQztRQUN2QixtQkFBYyxHQUFHLEVBQUUsQ0FBQztRQUNwQixrQkFBYSxHQUFHLEVBQUUs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QUM7Q0FDSjtBQW5oQkQsb0NBbWhCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBkZWJ1ZyBmcm9tICdkZWJ1Zyc7XG5pbXBvcnQgdGltZUxpbWl0IGZyb20gJ3RpbWUtbGltaXQtcHJvbWlzZSc7XG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdldmVudHMnO1xuaW1wb3J0IE11c3RhY2hlIGZyb20gJ211c3RhY2hlJztcbmltcG9ydCB7IHB1bGwgYXMgcmVtb3ZlIH0gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7XG4gICAgY2FsY3VsYXRlUHJldHR5VXNlckFnZW50LFxuICAgIGV4dHJhY3RNZXRhSW5mbyxcbiAgICBQYXJzZWRVc2VyQWdlbnQsXG4gICAgcGFyc2VVc2VyQWdlbnQsXG59IGZyb20gJy4uLy4uL3V0aWxzL3BhcnNlLXVzZXItYWdlbnQnO1xuaW1wb3J0IHsgcmVhZFN5bmMgYXMgcmVhZCB9IGZyb20gJ3JlYWQtZmlsZS1yZWxhdGl2ZSc7XG5pbXBvcnQgcHJvbWlzaWZ5RXZlbnQgZnJvbSAncHJvbWlzaWZ5LWV2ZW50JztcbmltcG9ydCB7IG5hbm9pZCB9IGZyb20gJ25hbm9pZCc7XG5pbXBvcnQgQ09NTUFORCBmcm9tICcuL2NvbW1hbmQnO1xuaW1wb3J0IEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzIGZyb20gJy4vc3RhdHVzJztcbmltcG9ydCBIZWFydGJlYXRTdGF0dXMgZnJvbSAnLi9oZWFydGJlYXQtc3RhdHVzJztcbmltcG9ydCB7IEdlbmVyYWxFcnJvciwgVGltZW91dEVycm9yIH0gZnJvbSAnLi4vLi4vZXJyb3JzL3J1bnRpbWUnO1xuaW1wb3J0IHsgUlVOVElNRV9FUlJPUlMgfSBmcm9tICcuLi8uLi9lcnJvcnMvdHlwZXMnO1xuaW1wb3J0IEJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheSBmcm9tICcuL2dhdGV3YXknO1xuaW1wb3J0IEJyb3dzZXJKb2IgZnJvbSAnLi4vLi4vcnVubmVyL2Jyb3dzZXItam9iJztcbmltcG9ydCBXYXJuaW5nTG9nIGZyb20gJy4uLy4uL25vdGlmaWNhdGlvbnMvd2FybmluZy1sb2cnO1xuaW1wb3J0IEJyb3dzZXJQcm92aWRlciBmcm9tICcuLi9wcm92aWRlcic7XG5pbXBvcnQgeyBPU0luZm8gfSBmcm9tICdnZXQtb3MtaW5mbyc7XG5pbXBvcnQgU0VSVklDRV9ST1VURVMgZnJvbSAnLi9zZXJ2aWNlLXJvdXRlcyc7XG5pbXBvcnQge1xuICAgIEJST1dTRVJfUkVTVEFSVF9USU1FT1VULFxuICAgIEJST1dTRVJfQ0xPU0VfVElNRU9VVCxcbiAgICBIRUFSVEJFQVRfVElNRU9VVCxcbiAgICBMT0NBTF9CUk9XU0VSX0lOSVRfVElNRU9VVCxcbiAgICBSRU1PVEVfQlJPV1NFUl9JTklUX1RJTUVPVVQsXG59IGZyb20gJy4uLy4uL3V0aWxzL2Jyb3dzZXItY29ubmVjdGlvbi10aW1lb3V0cyc7XG5pbXBvcnQgTWVzc2FnZUJ1cyBmcm9tICcuLi8uLi91dGlscy9tZXNzYWdlLWJ1cyc7XG5pbXBvcnQgQnJvd3NlckNvbm5lY3Rpb25UcmFja2VyIGZyb20gJy4vdHJhY2tlcic7XG5pbXBvcnQgVGVzdFJ1biBmcm9tICcuLi8uLi90ZXN0LXJ1bic7XG4vLyBAdHMtaWdub3JlXG5pbXBvcnQgeyBUZXN0UnVuIGFzIExlZ2FjeVRlc3RSdW4gfSBmcm9tICd0ZXN0Y2FmZS1sZWdhY3ktYXBpJztcbmltcG9ydCB7IFByb3h5IH0gZnJvbSAndGVzdGNhZmUtaGFtbWVyaGVhZCc7XG5pbXBvcnQgeyBOZXh0VGVzdFJ1bkluZm8sIE9wZW5Ccm93c2VyQWRkaXRpb25hbE9wdGlvbnMgfSBmcm9tICcuLi8uLi9zaGFyZWQvdHlwZXMnO1xuXG5jb25zdCBnZXRCcm93c2VyQ29ubmVjdGlvbkRlYnVnU2NvcGUgPSAoaWQ6IHN0cmluZyk6IHN0cmluZyA9PiBgdGVzdGNhZmU6YnJvd3Nlcjpjb25uZWN0aW9uOiR7aWR9YDtcblxuY29uc3QgSURMRV9QQUdFX1RFTVBMQVRFID0gcmVhZCgnLi4vLi4vY2xpZW50L2Jyb3dzZXIvaWRsZS1wYWdlL2luZGV4Lmh0bWwubXVzdGFjaGUnKTtcblxuXG5pbnRlcmZhY2UgRGlzY29ubmVjdGlvblByb21pc2U8VD4gZXh0ZW5kcyBQcm9taXNlPFQ+IHtcbiAgICByZXNvbHZlOiBGdW5jdGlvbjtcbiAgICByZWplY3Q6IEZ1bmN0aW9uO1xufVxuXG5pbnRlcmZhY2UgQnJvd3NlckNvbm5lY3Rpb25TdGF0dXNSZXN1bHQge1xuICAgIGNtZDogc3RyaW5nO1xuICAgIHVybDogc3RyaW5nO1xuICAgIHRlc3RSdW5JZDogc3RyaW5nIHwgbnVsbDtcbn1cblxuaW50ZXJmYWNlIEhlYXJ0YmVhdFN0YXR1c1Jlc3VsdCB7XG4gICAgY29kZTogSGVhcnRiZWF0U3RhdHVzO1xuICAgIHVybDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgSW5pdFNjcmlwdCB7XG4gICAgY29kZTogc3RyaW5nIHwgbnVsbDtcbn1cblxuaW50ZXJmYWNlIEluaXRTY3JpcHRUYXNrIGV4dGVuZHMgSW5pdFNjcmlwdCB7XG4gICAgcmVzb2x2ZTogRnVuY3Rpb247XG59XG5cbmludGVyZmFjZSBQcm92aWRlck1ldGFJbmZvT3B0aW9ucyB7XG4gICAgYXBwZW5kVG9Vc2VyQWdlbnQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJyb3dzZXJDbG9zaW5nSW5mbyB7XG4gICAgaXNSZXN0YXJ0aW5nPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCcm93c2VySW5mbyB7XG4gICAgYWxpYXM6IHN0cmluZztcbiAgICBicm93c2VyTmFtZTogc3RyaW5nO1xuICAgIGJyb3dzZXJPcHRpb246IHVua25vd247XG4gICAgcHJvdmlkZXJOYW1lOiBzdHJpbmc7XG4gICAgcHJvdmlkZXI6IEJyb3dzZXJQcm92aWRlcjtcbiAgICB1c2VyQWdlbnRQcm92aWRlck1ldGFJbmZvOiBzdHJpbmc7XG4gICAgcGFyc2VkVXNlckFnZW50OiBQYXJzZWRVc2VyQWdlbnQ7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJyb3dzZXJDb25uZWN0aW9uIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgICBwdWJsaWMgcGVybWFuZW50OiBib29sZWFuO1xuICAgIHB1YmxpYyBwcmV2aW91c0FjdGl2ZVdpbmRvd0lkOiBzdHJpbmcgfCBudWxsO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgZGlzYWJsZU11bHRpcGxlV2luZG93czogYm9vbGVhbjtcbiAgICBwdWJsaWMgcmVhZG9ubHkgcHJveHlsZXNzOiBib29sZWFuO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgSEVBUlRCRUFUX1RJTUVPVVQ6IG51bWJlcjtcbiAgICBwcml2YXRlIHJlYWRvbmx5IEJST1dTRVJfQ0xPU0VfVElNRU9VVDogbnVtYmVyO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgQlJPV1NFUl9SRVNUQVJUX1RJTUVPVVQ6IG51bWJlcjtcbiAgICBwdWJsaWMgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgICBwcml2YXRlIF9jdXJyZW50VGVzdFJ1bjogVGVzdFJ1biB8IG51bGwgPSBudWxsO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgam9iUXVldWU6IEJyb3dzZXJKb2JbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGluaXRTY3JpcHRzUXVldWU6IEluaXRTY3JpcHRUYXNrW107XG4gICAgcHVibGljIGJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheTogQnJvd3NlckNvbm5lY3Rpb25HYXRld2F5O1xuICAgIHByaXZhdGUgZGlzY29ubmVjdGlvblByb21pc2U6IERpc2Nvbm5lY3Rpb25Qcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgICBwcml2YXRlIHRlc3RSdW5BYm9ydGVkOiBib29sZWFuO1xuICAgIHB1YmxpYyBzdGF0dXM6IEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzO1xuICAgIHByaXZhdGUgaGVhcnRiZWF0VGltZW91dDogTm9kZUpTLlRpbWVvdXQgfCBudWxsO1xuICAgIHByaXZhdGUgcGVuZGluZ1Rlc3RSdW5JbmZvOiBOZXh0VGVzdFJ1bkluZm8gfCBudWxsO1xuICAgIHB1YmxpYyB1cmwgPSAnJztcbiAgICBwdWJsaWMgaWRsZVVybCA9ICcnO1xuICAgIHByaXZhdGUgZm9yY2VkSWRsZVVybCA9ICcnO1xuICAgIHByaXZhdGUgaW5pdFNjcmlwdFVybCA9ICcnO1xuICAgIHB1YmxpYyBoZWFydGJlYXRVcmwgPSAnJztcbiAgICBwdWJsaWMgc3RhdHVzVXJsID0gJyc7XG4gICAgcHVibGljIGFjdGl2ZVdpbmRvd0lkVXJsID0gJyc7XG4gICAgcHVibGljIGNsb3NlV2luZG93VXJsID0gJyc7XG4gICAgcHVibGljIHN0YXR1c0RvbmVVcmwgPSAnJztcbiAgICBwdWJsaWMgaGVhcnRiZWF0UmVsYXRpdmVVcmwgPSAnJztcbiAgICBwdWJsaWMgc3RhdHVzUmVsYXRpdmVVcmwgPSAnJztcbiAgICBwdWJsaWMgc3RhdHVzRG9uZVJlbGF0aXZlVXJsID0gJyc7XG4gICAgcHVibGljIGlkbGVSZWxhdGl2ZVVybCA9ICcnO1xuICAgIHB1YmxpYyBvcGVuRmlsZVByb3RvY29sUmVsYXRpdmVVcmwgPSAnJztcbiAgICBwdWJsaWMgb3BlbkZpbGVQcm90b2NvbFVybCA9ICcnO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgZGVidWdMb2dnZXI6IGRlYnVnLkRlYnVnZ2VyO1xuICAgIHByaXZhdGUgb3NJbmZvOiBPU0luZm8gfCBudWxsID0gbnVsbDtcblxuICAgIHB1YmxpYyByZWFkb25seSB3YXJuaW5nTG9nOiBXYXJuaW5nTG9nO1xuICAgIHByaXZhdGUgX21lc3NhZ2VCdXM/OiBNZXNzYWdlQnVzO1xuXG4gICAgcHVibGljIGlkbGU6IGJvb2xlYW47XG5cbiAgICBwdWJsaWMgYnJvd3NlckluZm86IEJyb3dzZXJJbmZvO1xuICAgIHB1YmxpYyBwcm92aWRlcjogYW55O1xuXG4gICAgcHVibGljIGNvbnN0cnVjdG9yIChcbiAgICAgICAgZ2F0ZXdheTogQnJvd3NlckNvbm5lY3Rpb25HYXRld2F5LFxuICAgICAgICBicm93c2VySW5mbzogQnJvd3NlckluZm8sXG4gICAgICAgIHBlcm1hbmVudDogYm9vbGVhbixcbiAgICAgICAgZGlzYWJsZU11bHRpcGxlV2luZG93cyA9IGZhbHNlLFxuICAgICAgICBwcm94eWxlc3MgPSBmYWxzZSxcbiAgICAgICAgbWVzc2FnZUJ1cz86IE1lc3NhZ2VCdXMpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICB0aGlzLkhFQVJUQkVBVF9USU1FT1VUICAgICAgID0gSEVBUlRCRUFUX1RJTUVPVVQ7XG4gICAgICAgIHRoaXMuQlJPV1NFUl9DTE9TRV9USU1FT1VUICAgPSBCUk9XU0VSX0NMT1NFX1RJTUVPVVQ7XG4gICAgICAgIHRoaXMuQlJPV1NFUl9SRVNUQVJUX1RJTUVPVVQgPSBCUk9XU0VSX1JFU1RBUlRfVElNRU9VVDtcblxuICAgICAgICB0aGlzLmlkICAgICAgICAgICAgICAgICAgICAgICA9IEJyb3dzZXJDb25uZWN0aW9uLl9nZW5lcmF0ZUlkKCk7XG4gICAgICAgIHRoaXMuam9iUXVldWUgICAgICAgICAgICAgICAgID0gW107XG4gICAgICAgIHRoaXMuaW5pdFNjcmlwdHNRdWV1ZSAgICAgICAgID0gW107XG4gICAgICAgIHRoaXMuYnJvd3NlckNvbm5lY3Rpb25HYXRld2F5ID0gZ2F0ZXdheTtcbiAgICAgICAgdGhpcy5kaXNjb25uZWN0aW9uUHJvbWlzZSAgICAgPSBudWxsO1xuICAgICAgICB0aGlzLnRlc3RSdW5BYm9ydGVkICAgICAgICAgICA9IGZhbHNlO1xuICAgICAgICB0aGlzLndhcm5pbmdMb2cgICAgICAgICAgICAgICA9IG5ldyBXYXJuaW5nTG9nKG51bGwsIFdhcm5pbmdMb2cuY3JlYXRlQWRkV2FybmluZ0NhbGxiYWNrKG1lc3NhZ2VCdXMpKTtcbiAgICAgICAgdGhpcy5kZWJ1Z0xvZ2dlciAgICAgICAgICAgICAgPSBkZWJ1ZyhnZXRCcm93c2VyQ29ubmVjdGlvbkRlYnVnU2NvcGUodGhpcy5pZCkpO1xuXG4gICAgICAgIGlmIChtZXNzYWdlQnVzKVxuICAgICAgICAgICAgdGhpcy5tZXNzYWdlQnVzID0gbWVzc2FnZUJ1cztcblxuICAgICAgICB0aGlzLmJyb3dzZXJJbmZvICAgICAgICAgICAgICAgICAgICAgICAgICAgPSBicm93c2VySW5mbztcbiAgICAgICAgdGhpcy5icm93c2VySW5mby51c2VyQWdlbnRQcm92aWRlck1ldGFJbmZvID0gJyc7XG5cbiAgICAgICAgdGhpcy5wcm92aWRlciA9IGJyb3dzZXJJbmZvLnByb3ZpZGVyO1xuXG4gICAgICAgIHRoaXMucGVybWFuZW50ICAgICAgICAgICAgICA9IHBlcm1hbmVudDtcbiAgICAgICAgdGhpcy5zdGF0dXMgICAgICAgICAgICAgICAgID0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMudW5pbml0aWFsaXplZDtcbiAgICAgICAgdGhpcy5pZGxlICAgICAgICAgICAgICAgICAgID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5oZWFydGJlYXRUaW1lb3V0ICAgICAgID0gbnVsbDtcbiAgICAgICAgdGhpcy5wZW5kaW5nVGVzdFJ1bkluZm8gICAgID0gbnVsbDtcbiAgICAgICAgdGhpcy5kaXNhYmxlTXVsdGlwbGVXaW5kb3dzID0gZGlzYWJsZU11bHRpcGxlV2luZG93cztcbiAgICAgICAgdGhpcy5wcm94eWxlc3MgICAgICAgICAgICAgID0gcHJveHlsZXNzO1xuXG4gICAgICAgIHRoaXMuX2J1aWxkQ29tbXVuaWNhdGlvblVybHMoZ2F0ZXdheS5wcm94eSk7XG4gICAgICAgIHRoaXMuX3NldEV2ZW50SGFuZGxlcnMoKTtcblxuICAgICAgICBCcm93c2VyQ29ubmVjdGlvblRyYWNrZXIuYWRkKHRoaXMpO1xuXG4gICAgICAgIHRoaXMucHJldmlvdXNBY3RpdmVXaW5kb3dJZCA9IG51bGw7XG5cbiAgICAgICAgdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkuc3RhcnRTZXJ2aW5nQ29ubmVjdGlvbih0aGlzKTtcblxuICAgICAgICAvLyBOT1RFOiBHaXZlIGEgY2FsbGVyIHRpbWUgdG8gYXNzaWduIGV2ZW50IGxpc3RlbmVyc1xuICAgICAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHRoaXMuX3J1bkJyb3dzZXIoKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfYnVpbGRDb21tdW5pY2F0aW9uVXJscyAocHJveHk6IFByb3h5KTogdm9pZCB7XG4gICAgICAgIHRoaXMudXJsICAgICAgICAgICAgICAgPSBwcm94eS5yZXNvbHZlUmVsYXRpdmVTZXJ2aWNlVXJsKGAke1NFUlZJQ0VfUk9VVEVTLmNvbm5lY3R9LyR7dGhpcy5pZH1gKTtcbiAgICAgICAgdGhpcy5mb3JjZWRJZGxlVXJsICAgICA9IHByb3h5LnJlc29sdmVSZWxhdGl2ZVNlcnZpY2VVcmwoYCR7U0VSVklDRV9ST1VURVMuaWRsZUZvcmNlZH0vJHt0aGlzLmlkfWApO1xuICAgICAgICB0aGlzLmluaXRTY3JpcHRVcmwgICAgID0gcHJveHkucmVzb2x2ZVJlbGF0aXZlU2VydmljZVVybChgJHtTRVJWSUNFX1JPVVRFUy5pbml0U2NyaXB0fS8ke3RoaXMuaWR9YCk7XG5cbiAgICAgICAgdGhpcy5oZWFydGJlYXRSZWxhdGl2ZVVybCAgICAgICAgPSBgJHtTRVJWSUNFX1JPVVRFUy5oZWFydGJlYXR9LyR7dGhpcy5pZH1gO1xuICAgICAgICB0aGlzLnN0YXR1c1JlbGF0aXZlVXJsICAgICAgICAgICA9IGAke1NFUlZJQ0VfUk9VVEVTLnN0YXR1c30vJHt0aGlzLmlkfWA7XG4gICAgICAgIHRoaXMuc3RhdHVzRG9uZVJlbGF0aXZlVXJsICAgICAgID0gYCR7U0VSVklDRV9ST1VURVMuc3RhdHVzRG9uZX0vJHt0aGlzLmlkfWA7XG4gICAgICAgIHRoaXMuaWRsZVJlbGF0aXZlVXJsICAgICAgICAgICAgID0gYCR7U0VSVklDRV9ST1VURVMuaWRsZX0vJHt0aGlzLmlkfWA7XG4gICAgICAgIHRoaXMuYWN0aXZlV2luZG93SWRVcmwgICAgICAgICAgID0gYCR7U0VSVklDRV9ST1VURVMuYWN0aXZlV2luZG93SWR9LyR7dGhpcy5pZH1gO1xuICAgICAgICB0aGlzLmNsb3NlV2luZG93VXJsICAgICAgICAgICAgICA9IGAke1NFUlZJQ0VfUk9VVEVTLmNsb3NlV2luZG93fS8ke3RoaXMuaWR9YDtcbiAgICAgICAgdGhpcy5vcGVuRmlsZVByb3RvY29sUmVsYXRpdmVVcmwgPSBgJHtTRVJWSUNFX1JPVVRFUy5vcGVuRmlsZVByb3RvY29sfS8ke3RoaXMuaWR9YDtcblxuICAgICAgICB0aGlzLmlkbGVVcmwgICAgICAgICAgICAgPSBwcm94eS5yZXNvbHZlUmVsYXRpdmVTZXJ2aWNlVXJsKHRoaXMuaWRsZVJlbGF0aXZlVXJsKTtcbiAgICAgICAgdGhpcy5oZWFydGJlYXRVcmwgICAgICAgID0gcHJveHkucmVzb2x2ZVJlbGF0aXZlU2VydmljZVVybCh0aGlzLmhlYXJ0YmVhdFJlbGF0aXZlVXJsKTtcbiAgICAgICAgdGhpcy5zdGF0dXNVcmwgICAgICAgICAgID0gcHJveHkucmVzb2x2ZVJlbGF0aXZlU2VydmljZVVybCh0aGlzLnN0YXR1c1JlbGF0aXZlVXJsKTtcbiAgICAgICAgdGhpcy5zdGF0dXNEb25lVXJsICAgICAgID0gcHJveHkucmVzb2x2ZVJlbGF0aXZlU2VydmljZVVybCh0aGlzLnN0YXR1c0RvbmVSZWxhdGl2ZVVybCk7XG4gICAgICAgIHRoaXMub3BlbkZpbGVQcm90b2NvbFVybCA9IHByb3h5LnJlc29sdmVSZWxhdGl2ZVNlcnZpY2VVcmwodGhpcy5vcGVuRmlsZVByb3RvY29sUmVsYXRpdmVVcmwpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXQgbWVzc2FnZUJ1cyAobWVzc2FnZUJ1czogTWVzc2FnZUJ1cykge1xuICAgICAgICB0aGlzLl9tZXNzYWdlQnVzICAgICAgICAgPSBtZXNzYWdlQnVzO1xuICAgICAgICB0aGlzLndhcm5pbmdMb2cuY2FsbGJhY2sgPSBXYXJuaW5nTG9nLmNyZWF0ZUFkZFdhcm5pbmdDYWxsYmFjayh0aGlzLl9tZXNzYWdlQnVzKTtcblxuICAgICAgICBpZiAobWVzc2FnZUJ1cykge1xuICAgICAgICAgICAgbWVzc2FnZUJ1cy5vbigndGVzdC1ydW4tc3RhcnQnLCB0ZXN0UnVuID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodGVzdFJ1bi5icm93c2VyQ29ubmVjdGlvbi5pZCA9PT0gdGhpcy5pZClcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3VycmVudFRlc3RSdW4gPSB0ZXN0UnVuO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9zZXRFdmVudEhhbmRsZXJzICgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5vbignZXJyb3InLCBlID0+IHtcbiAgICAgICAgICAgIHRoaXMuZGVidWdMb2dnZXIoZSk7XG4gICAgICAgICAgICB0aGlzLl9mb3JjZUlkbGUoKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBuYW1lIGluIEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGF0dXMgPSBCcm93c2VyQ29ubmVjdGlvblN0YXR1c1tuYW1lIGFzIGtleW9mIHR5cGVvZiBCcm93c2VyQ29ubmVjdGlvblN0YXR1c107XG5cbiAgICAgICAgICAgIHRoaXMub24oc3RhdHVzLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5kZWJ1Z0xvZ2dlcihgc3RhdHVzIGNoYW5nZWQgdG8gJyR7c3RhdHVzfSdgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzdGF0aWMgX2dlbmVyYXRlSWQgKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBuYW5vaWQoNyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfZ2V0QWRkaXRpb25hbEJyb3dzZXJPcHRpb25zICgpOiBPcGVuQnJvd3NlckFkZGl0aW9uYWxPcHRpb25zIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGRpc2FibGVNdWx0aXBsZVdpbmRvd3M6IHRoaXMuZGlzYWJsZU11bHRpcGxlV2luZG93cyxcbiAgICAgICAgfSBhcyBPcGVuQnJvd3NlckFkZGl0aW9uYWxPcHRpb25zO1xuXG4gICAgICAgIGlmICh0aGlzLnByb3h5bGVzcykge1xuICAgICAgICAgICAgb3B0aW9ucy5wcm94eWxlc3MgPSB7XG4gICAgICAgICAgICAgICAgc2VydmljZURvbWFpbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkucHJveHkuc2VydmVyMUluZm8uZG9tYWluLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheS5wcm94eS5zZXJ2ZXIySW5mby5kb21haW4sXG4gICAgICAgICAgICAgICAgXSxcblxuICAgICAgICAgICAgICAgIGRldmVsb3BtZW50TW9kZTogdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkucHJveHkub3B0aW9ucy5kZXZlbG9wbWVudE1vZGUsXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG9wdGlvbnM7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcnVuQnJvd3NlciAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHRoaXMuX2dldEFkZGl0aW9uYWxCcm93c2VyT3B0aW9ucygpO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnByb3ZpZGVyLm9wZW5Ccm93c2VyKHRoaXMuaWQsIHRoaXMudXJsLCB0aGlzLmJyb3dzZXJJbmZvLmJyb3dzZXJPcHRpb24sIGFkZGl0aW9uYWxPcHRpb25zKTtcblxuICAgICAgICAgICAgaWYgKHRoaXMuc3RhdHVzICE9PSBCcm93c2VyQ29ubmVjdGlvblN0YXR1cy5yZWFkeSlcbiAgICAgICAgICAgICAgICBhd2FpdCBwcm9taXNpZnlFdmVudCh0aGlzLCAncmVhZHknKTtcblxuICAgICAgICAgICAgdGhpcy5zdGF0dXMgPSBCcm93c2VyQ29ubmVjdGlvblN0YXR1cy5vcGVuZWQ7XG4gICAgICAgICAgICB0aGlzLmVtaXQoJ29wZW5lZCcpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIG5ldyBHZW5lcmFsRXJyb3IoXG4gICAgICAgICAgICAgICAgUlVOVElNRV9FUlJPUlMudW5hYmxlVG9PcGVuQnJvd3NlcixcbiAgICAgICAgICAgICAgICB0aGlzLmJyb3dzZXJJbmZvLnByb3ZpZGVyTmFtZSArICc6JyArIHRoaXMuYnJvd3NlckluZm8uYnJvd3Nlck5hbWUsXG4gICAgICAgICAgICAgICAgZXJyLnN0YWNrXG4gICAgICAgICAgICApKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2Nsb3NlQnJvd3NlciAoZGF0YTogQnJvd3NlckNsb3NpbmdJbmZvID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCF0aGlzLmlkbGUpXG4gICAgICAgICAgICBhd2FpdCBwcm9taXNpZnlFdmVudCh0aGlzLCAnaWRsZScpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnByb3ZpZGVyLmNsb3NlQnJvd3Nlcih0aGlzLmlkLCBkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAvLyBOT1RFOiBBIHdhcm5pbmcgd291bGQgYmUgcmVhbGx5IG5pY2UgaGVyZSwgYnV0IGl0IGNhbid0IGJlIGRvbmUgd2hpbGUgbG9nIGlzIHN0b3JlZCBpbiBhIHRhc2suXG4gICAgICAgICAgICB0aGlzLmRlYnVnTG9nZ2VyKGVycik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9mb3JjZUlkbGUgKCk6IHZvaWQge1xuICAgICAgICBpZiAoIXRoaXMuaWRsZSkge1xuICAgICAgICAgICAgdGhpcy5pZGxlID0gdHJ1ZTtcblxuICAgICAgICAgICAgdGhpcy5lbWl0KCdpZGxlJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9jcmVhdGVCcm93c2VyRGlzY29ubmVjdGVkRXJyb3IgKCk6IEdlbmVyYWxFcnJvciB7XG4gICAgICAgIHJldHVybiBuZXcgR2VuZXJhbEVycm9yKFJVTlRJTUVfRVJST1JTLmJyb3dzZXJEaXNjb25uZWN0ZWQsIHRoaXMudXNlckFnZW50KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF93YWl0Rm9ySGVhcnRiZWF0ICgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5oZWFydGJlYXRUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBlcnIgPSB0aGlzLl9jcmVhdGVCcm93c2VyRGlzY29ubmVjdGVkRXJyb3IoKTtcblxuICAgICAgICAgICAgdGhpcy5zdGF0dXMgICAgICAgICA9IEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzLmRpc2Nvbm5lY3RlZDtcbiAgICAgICAgICAgIHRoaXMudGVzdFJ1bkFib3J0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICB0aGlzLmVtaXQoJ2Rpc2Nvbm5lY3RlZCcsIGVycik7XG5cbiAgICAgICAgICAgIHRoaXMuX3Jlc3RhcnRCcm93c2VyT25EaXNjb25uZWN0KGVycik7XG4gICAgICAgIH0sIHRoaXMuSEVBUlRCRUFUX1RJTUVPVVQpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX2dldFRlc3RSdW5JbmZvIChuZWVkUG9wTmV4dDogYm9vbGVhbik6IFByb21pc2U8TmV4dFRlc3RSdW5JbmZvPiB7XG4gICAgICAgIGlmIChuZWVkUG9wTmV4dCB8fCAhdGhpcy5wZW5kaW5nVGVzdFJ1bkluZm8pXG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdUZXN0UnVuSW5mbyA9IGF3YWl0IHRoaXMuX3BvcE5leHRUZXN0UnVuSW5mbygpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnBlbmRpbmdUZXN0UnVuSW5mbyBhcyBOZXh0VGVzdFJ1bkluZm87XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcG9wTmV4dFRlc3RSdW5JbmZvICgpOiBQcm9taXNlPE5leHRUZXN0UnVuSW5mbyB8IG51bGw+IHtcbiAgICAgICAgd2hpbGUgKHRoaXMuaGFzUXVldWVkSm9icyAmJiAhdGhpcy5jdXJyZW50Sm9iLmhhc1F1ZXVlZFRlc3RSdW5zKVxuICAgICAgICAgICAgdGhpcy5qb2JRdWV1ZS5zaGlmdCgpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmhhc1F1ZXVlZEpvYnMgPyBhd2FpdCB0aGlzLmN1cnJlbnRKb2IucG9wTmV4dFRlc3RSdW5JbmZvKHRoaXMpIDogbnVsbDtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0Q3VycmVudFRlc3RSdW4gKCk6IExlZ2FjeVRlc3RSdW4gfCBUZXN0UnVuIHwgbnVsbCB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jdXJyZW50VGVzdFJ1bjtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RhdGljIGdldEJ5SWQgKGlkOiBzdHJpbmcpOiBCcm93c2VyQ29ubmVjdGlvbiB8IG51bGwge1xuICAgICAgICByZXR1cm4gQnJvd3NlckNvbm5lY3Rpb25UcmFja2VyLmFjdGl2ZUJyb3dzZXJDb25uZWN0aW9uc1tpZF0gfHwgbnVsbDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9yZXN0YXJ0QnJvd3NlciAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRoaXMuc3RhdHVzID0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMudW5pbml0aWFsaXplZDtcblxuICAgICAgICB0aGlzLl9mb3JjZUlkbGUoKTtcblxuICAgICAgICBsZXQgcmVzb2x2ZVRpbWVvdXQ6IEZ1bmN0aW9uIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIGxldCBpc1RpbWVvdXRFeHBpcmVkICAgICAgICAgICAgICAgID0gZmFsc2U7XG4gICAgICAgIGxldCB0aW1lb3V0OiBOb2RlSlMuVGltZW91dCB8IG51bGwgID0gbnVsbDtcblxuICAgICAgICBjb25zdCByZXN0YXJ0UHJvbWlzZSA9IHRpbWVMaW1pdCh0aGlzLl9jbG9zZUJyb3dzZXIoeyBpc1Jlc3RhcnRpbmc6IHRydWUgfSksIHRoaXMuQlJPV1NFUl9DTE9TRV9USU1FT1VULCB7IHJlamVjdFdpdGg6IG5ldyBUaW1lb3V0RXJyb3IoKSB9KVxuICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmRlYnVnTG9nZ2VyKGVycikpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLl9ydW5Ccm93c2VyKCkpO1xuXG4gICAgICAgIGNvbnN0IHRpbWVvdXRQcm9taXNlID0gbmV3IFByb21pc2U8dm9pZD4ocmVzb2x2ZSA9PiB7XG4gICAgICAgICAgICByZXNvbHZlVGltZW91dCA9IHJlc29sdmU7XG5cbiAgICAgICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBpc1RpbWVvdXRFeHBpcmVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgIH0sIHRoaXMuQlJPV1NFUl9SRVNUQVJUX1RJTUVPVVQpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yYWNlKFtyZXN0YXJ0UHJvbWlzZSwgdGltZW91dFByb21pc2VdKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0IGFzIE5vZGVKUy5UaW1lb3V0KTtcblxuICAgICAgICAgICAgICAgIGlmIChpc1RpbWVvdXRFeHBpcmVkKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgdGhpcy5fY3JlYXRlQnJvd3NlckRpc2Nvbm5lY3RlZEVycm9yKCkpO1xuICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgKHJlc29sdmVUaW1lb3V0IGFzIEZ1bmN0aW9uKSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcmVzdGFydEJyb3dzZXJPbkRpc2Nvbm5lY3QgKGVycjogRXJyb3IpOiB2b2lkIHtcbiAgICAgICAgbGV0IHJlc29sdmVGbjogRnVuY3Rpb24gfCBudWxsID0gbnVsbDtcbiAgICAgICAgbGV0IHJlamVjdEZuOiBGdW5jdGlvbiB8IG51bGwgID0gbnVsbDtcblxuICAgICAgICB0aGlzLmRpc2Nvbm5lY3Rpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZUZuID0gcmVzb2x2ZTtcblxuICAgICAgICAgICAgcmVqZWN0Rm4gPSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAocmVqZWN0Rm4gYXMgRnVuY3Rpb24pKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVzdGFydEJyb3dzZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuY2F0Y2goZSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGUpO1xuICAgICAgICAgICAgfSkgYXMgRGlzY29ubmVjdGlvblByb21pc2U8dm9pZD47XG5cbiAgICAgICAgdGhpcy5kaXNjb25uZWN0aW9uUHJvbWlzZS5yZXNvbHZlID0gcmVzb2x2ZUZuIGFzIHVua25vd24gYXMgRnVuY3Rpb247XG4gICAgICAgIHRoaXMuZGlzY29ubmVjdGlvblByb21pc2UucmVqZWN0ICA9IHJlamVjdEZuIGFzIHVua25vd24gYXMgRnVuY3Rpb247XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGdldERlZmF1bHRCcm93c2VySW5pdFRpbWVvdXQgKCk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgICAgIGNvbnN0IGlzTG9jYWxCcm93c2VyID0gYXdhaXQgdGhpcy5wcm92aWRlci5pc0xvY2FsQnJvd3Nlcih0aGlzLmlkLCB0aGlzLmJyb3dzZXJJbmZvLmJyb3dzZXJOYW1lKTtcblxuICAgICAgICByZXR1cm4gaXNMb2NhbEJyb3dzZXIgPyBMT0NBTF9CUk9XU0VSX0lOSVRfVElNRU9VVCA6IFJFTU9URV9CUk9XU0VSX0lOSVRfVElNRU9VVDtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgcHJvY2Vzc0Rpc2Nvbm5lY3Rpb24gKGRpc2Nvbm5lY3Rpb25UaHJlc2hvbGRFeGNlZWRlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCB7IHJlc29sdmUsIHJlamVjdCB9ID0gdGhpcy5kaXNjb25uZWN0aW9uUHJvbWlzZSBhcyBEaXNjb25uZWN0aW9uUHJvbWlzZTx2b2lkPjtcblxuICAgICAgICBpZiAoZGlzY29ubmVjdGlvblRocmVzaG9sZEV4Y2VlZGVkKVxuICAgICAgICAgICAgcmVqZWN0KCk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgYWRkV2FybmluZyAobWVzc2FnZTogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5jdXJyZW50Sm9iKVxuICAgICAgICAgICAgdGhpcy5jdXJyZW50Sm9iLndhcm5pbmdMb2cuYWRkV2FybmluZyhtZXNzYWdlLCAuLi5hcmdzKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgdGhpcy53YXJuaW5nTG9nLmFkZFdhcm5pbmcobWVzc2FnZSwgLi4uYXJncyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfYXBwZW5kVG9QcmV0dHlVc2VyQWdlbnQgKHN0cjogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIHRoaXMuYnJvd3NlckluZm8ucGFyc2VkVXNlckFnZW50LnByZXR0eVVzZXJBZ2VudCArPSBgICgke3N0cn0pYDtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9tb3ZlV2FybmluZ0xvZ1RvSm9iIChqb2I6IEJyb3dzZXJKb2IpOiB2b2lkIHtcbiAgICAgICAgam9iLndhcm5pbmdMb2cuY29weUZyb20odGhpcy53YXJuaW5nTG9nKTtcbiAgICAgICAgdGhpcy53YXJuaW5nTG9nLmNsZWFyKCk7XG4gICAgfVxuXG4gICAgcHVibGljIHNldFByb3ZpZGVyTWV0YUluZm8gKHN0cjogc3RyaW5nLCBvcHRpb25zPzogUHJvdmlkZXJNZXRhSW5mb09wdGlvbnMpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgYXBwZW5kVG9Vc2VyQWdlbnQgPSBvcHRpb25zPy5hcHBlbmRUb1VzZXJBZ2VudCBhcyBib29sZWFuO1xuXG4gICAgICAgIGlmIChhcHBlbmRUb1VzZXJBZ2VudCkge1xuICAgICAgICAgICAgLy8gTk9URTpcbiAgICAgICAgICAgIC8vIGNoYW5nZSBwcmV0dHlVc2VyQWdlbnQgb25seSB3aGVuIGNvbm5lY3Rpb24gYWxyZWFkeSB3YXMgZXN0YWJsaXNoZWRcbiAgICAgICAgICAgIGlmICh0aGlzLmlzUmVhZHkoKSlcbiAgICAgICAgICAgICAgICB0aGlzLl9hcHBlbmRUb1ByZXR0eVVzZXJBZ2VudChzdHIpO1xuICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgIHRoaXMub24oJ3JlYWR5JywgKCkgPT4gdGhpcy5fYXBwZW5kVG9QcmV0dHlVc2VyQWdlbnQoc3RyKSk7XG5cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuYnJvd3NlckluZm8udXNlckFnZW50UHJvdmlkZXJNZXRhSW5mbyA9IHN0cjtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0IHVzZXJBZ2VudCAoKTogc3RyaW5nIHtcbiAgICAgICAgbGV0IHVzZXJBZ2VudCA9IHRoaXMuYnJvd3NlckluZm8ucGFyc2VkVXNlckFnZW50LnByZXR0eVVzZXJBZ2VudDtcblxuICAgICAgICBpZiAodGhpcy5icm93c2VySW5mby51c2VyQWdlbnRQcm92aWRlck1ldGFJbmZvKVxuICAgICAgICAgICAgdXNlckFnZW50ICs9IGAgKCR7dGhpcy5icm93c2VySW5mby51c2VyQWdlbnRQcm92aWRlck1ldGFJbmZvfSlgO1xuXG4gICAgICAgIHJldHVybiB1c2VyQWdlbnQ7XG4gICAgfVxuXG4gICAgcHVibGljIGdldCBjb25uZWN0aW9uSW5mbyAoKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCF0aGlzLm9zSW5mbylcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVzZXJBZ2VudDtcblxuICAgICAgICBjb25zdCB7IG5hbWUsIHZlcnNpb24gfSA9IHRoaXMuYnJvd3NlckluZm8ucGFyc2VkVXNlckFnZW50O1xuICAgICAgICBsZXQgY29ubmVjdGlvbkluZm8gICAgICA9IGNhbGN1bGF0ZVByZXR0eVVzZXJBZ2VudCh7IG5hbWUsIHZlcnNpb24gfSwgdGhpcy5vc0luZm8pO1xuICAgICAgICBjb25zdCBtZXRhSW5mbyAgICAgICAgICA9IHRoaXMuYnJvd3NlckluZm8udXNlckFnZW50UHJvdmlkZXJNZXRhSW5mbyB8fCBleHRyYWN0TWV0YUluZm8odGhpcy5icm93c2VySW5mby5wYXJzZWRVc2VyQWdlbnQucHJldHR5VXNlckFnZW50KTtcblxuICAgICAgICBpZiAobWV0YUluZm8pXG4gICAgICAgICAgICBjb25uZWN0aW9uSW5mbyArPSBgICgkeyBtZXRhSW5mbyB9KWA7XG5cbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb25JbmZvO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXQgcmV0cnlUZXN0UGFnZXMgKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkucmV0cnlUZXN0UGFnZXM7XG4gICAgfVxuXG4gICAgcHVibGljIGdldCBoYXNRdWV1ZWRKb2JzICgpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5qb2JRdWV1ZS5sZW5ndGg7XG4gICAgfVxuXG4gICAgcHVibGljIGdldCBjdXJyZW50Sm9iICgpOiBCcm93c2VySm9iIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuam9iUXVldWVbMF07XG4gICAgfVxuXG4gICAgLy8gQVBJXG4gICAgcHVibGljIHJ1bkluaXRTY3JpcHQgKGNvZGU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5rbm93bj4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB0aGlzLmluaXRTY3JpcHRzUXVldWUucHVzaCh7IGNvZGUsIHJlc29sdmUgfSkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhZGRKb2IgKGpvYjogQnJvd3NlckpvYik6IHZvaWQge1xuICAgICAgICB0aGlzLmpvYlF1ZXVlLnB1c2goam9iKTtcblxuICAgICAgICB0aGlzLl9tb3ZlV2FybmluZ0xvZ1RvSm9iKGpvYik7XG4gICAgfVxuXG4gICAgcHVibGljIHJlbW92ZUpvYiAoam9iOiBCcm93c2VySm9iKTogdm9pZCB7XG4gICAgICAgIHJlbW92ZSh0aGlzLmpvYlF1ZXVlLCBqb2IpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBjbG9zZSAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMuY2xvc2luZyB8fCB0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMuY2xvc2VkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuc3RhdHVzID0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMuY2xvc2luZztcbiAgICAgICAgdGhpcy5lbWl0KEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzLmNsb3NpbmcpO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQnJvd3NlcigpO1xuXG4gICAgICAgIHRoaXMuYnJvd3NlckNvbm5lY3Rpb25HYXRld2F5LnN0b3BTZXJ2aW5nQ29ubmVjdGlvbih0aGlzKTtcblxuICAgICAgICBpZiAodGhpcy5oZWFydGJlYXRUaW1lb3V0KVxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuaGVhcnRiZWF0VGltZW91dCk7XG5cbiAgICAgICAgQnJvd3NlckNvbm5lY3Rpb25UcmFja2VyLnJlbW92ZSh0aGlzKTtcblxuICAgICAgICB0aGlzLnN0YXR1cyA9IEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzLmNsb3NlZDtcbiAgICAgICAgdGhpcy5lbWl0KEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzLmNsb3NlZCk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGVzdGFibGlzaCAodXNlckFnZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgdGhpcy5zdGF0dXMgICAgICAgICAgICAgICAgICAgICAgPSBCcm93c2VyQ29ubmVjdGlvblN0YXR1cy5yZWFkeTtcbiAgICAgICAgdGhpcy5icm93c2VySW5mby5wYXJzZWRVc2VyQWdlbnQgPSBwYXJzZVVzZXJBZ2VudCh1c2VyQWdlbnQpO1xuICAgICAgICB0aGlzLm9zSW5mbyAgICAgICAgICAgICAgICAgICAgICA9IGF3YWl0IHRoaXMucHJvdmlkZXIuZ2V0T1NJbmZvKHRoaXMuaWQpO1xuXG4gICAgICAgIHRoaXMuX3dhaXRGb3JIZWFydGJlYXQoKTtcbiAgICAgICAgdGhpcy5lbWl0KCdyZWFkeScpO1xuICAgIH1cblxuICAgIHB1YmxpYyBoZWFydGJlYXQgKCk6IEhlYXJ0YmVhdFN0YXR1c1Jlc3VsdCB7XG4gICAgICAgIGlmICh0aGlzLmhlYXJ0YmVhdFRpbWVvdXQpXG4gICAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5oZWFydGJlYXRUaW1lb3V0KTtcblxuICAgICAgICB0aGlzLl93YWl0Rm9ySGVhcnRiZWF0KCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IHRoaXMuc3RhdHVzID09PSBCcm93c2VyQ29ubmVjdGlvblN0YXR1cy5jbG9zaW5nID8gSGVhcnRiZWF0U3RhdHVzLmNsb3NpbmcgOiBIZWFydGJlYXRTdGF0dXMub2ssXG4gICAgICAgICAgICB1cmw6ICB0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMuY2xvc2luZyA/IHRoaXMuaWRsZVVybCA6ICcnLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHB1YmxpYyByZW5kZXJJZGxlUGFnZSAoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIE11c3RhY2hlLnJlbmRlcihJRExFX1BBR0VfVEVNUExBVEUgYXMgc3RyaW5nLCB7XG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25JbmZvLFxuICAgICAgICAgICAgc3RhdHVzVXJsOiAgICAgICAgICAgdGhpcy5zdGF0dXNVcmwsXG4gICAgICAgICAgICBoZWFydGJlYXRVcmw6ICAgICAgICB0aGlzLmhlYXJ0YmVhdFVybCxcbiAgICAgICAgICAgIGluaXRTY3JpcHRVcmw6ICAgICAgIHRoaXMuaW5pdFNjcmlwdFVybCxcbiAgICAgICAgICAgIG9wZW5GaWxlUHJvdG9jb2xVcmw6IHRoaXMub3BlbkZpbGVQcm90b2NvbFVybCxcbiAgICAgICAgICAgIHJldHJ5VGVzdFBhZ2VzOiAgICAgICEhdGhpcy5icm93c2VyQ29ubmVjdGlvbkdhdGV3YXkucmV0cnlUZXN0UGFnZXMsXG4gICAgICAgICAgICBwcm94eWxlc3M6ICAgICAgICAgICB0aGlzLnByb3h5bGVzcyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEluaXRTY3JpcHQgKCk6IEluaXRTY3JpcHQge1xuICAgICAgICBjb25zdCBpbml0U2NyaXB0UHJvbWlzZSA9IHRoaXMuaW5pdFNjcmlwdHNRdWV1ZVswXTtcblxuICAgICAgICByZXR1cm4geyBjb2RlOiBpbml0U2NyaXB0UHJvbWlzZSA/IGluaXRTY3JpcHRQcm9taXNlLmNvZGUgOiBudWxsIH07XG4gICAgfVxuXG4gICAgcHVibGljIGhhbmRsZUluaXRTY3JpcHRSZXN1bHQgKGRhdGE6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBpbml0U2NyaXB0UHJvbWlzZSA9IHRoaXMuaW5pdFNjcmlwdHNRdWV1ZS5zaGlmdCgpO1xuXG4gICAgICAgIGlmIChpbml0U2NyaXB0UHJvbWlzZSlcbiAgICAgICAgICAgIGluaXRTY3JpcHRQcm9taXNlLnJlc29sdmUoSlNPTi5wYXJzZShkYXRhKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGlzSGVhZGxlc3NCcm93c2VyICgpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvdmlkZXIuaXNIZWFkbGVzc0Jyb3dzZXIodGhpcy5pZCk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHJlcG9ydEpvYlJlc3VsdCAoc3RhdHVzOiBzdHJpbmcsIGRhdGE6IGFueSk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHJvdmlkZXIucmVwb3J0Sm9iUmVzdWx0KHRoaXMuaWQsIHN0YXR1cywgZGF0YSk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGdldFN0YXR1cyAoaXNUZXN0RG9uZTogYm9vbGVhbik6IFByb21pc2U8QnJvd3NlckNvbm5lY3Rpb25TdGF0dXNSZXN1bHQ+IHtcbiAgICAgICAgaWYgKCF0aGlzLmlkbGUgJiYgIWlzVGVzdERvbmUpIHtcbiAgICAgICAgICAgIHRoaXMuaWRsZSA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLmVtaXQoJ2lkbGUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMub3BlbmVkKSB7XG4gICAgICAgICAgICBjb25zdCBuZXh0VGVzdFJ1bkluZm8gPSBhd2FpdCB0aGlzLl9nZXRUZXN0UnVuSW5mbyhpc1Rlc3REb25lIHx8IHRoaXMudGVzdFJ1bkFib3J0ZWQpO1xuXG4gICAgICAgICAgICB0aGlzLnRlc3RSdW5BYm9ydGVkID0gZmFsc2U7XG5cbiAgICAgICAgICAgIGlmIChuZXh0VGVzdFJ1bkluZm8pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmlkbGUgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGNtZDogICAgICAgQ09NTUFORC5ydW4sXG4gICAgICAgICAgICAgICAgICAgIHRlc3RSdW5JZDogbmV4dFRlc3RSdW5JbmZvLnRlc3RSdW5JZCxcbiAgICAgICAgICAgICAgICAgICAgdXJsOiAgICAgICBuZXh0VGVzdFJ1bkluZm8udXJsLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY21kOiAgICAgICBDT01NQU5ELmlkbGUsXG4gICAgICAgICAgICB1cmw6ICAgICAgIHRoaXMuaWRsZVVybCxcbiAgICAgICAgICAgIHRlc3RSdW5JZDogbnVsbCxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0IGFjdGl2ZVdpbmRvd0lkICgpOiBudWxsIHwgc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvdmlkZXIuZ2V0QWN0aXZlV2luZG93SWQodGhpcy5pZCk7XG4gICAgfVxuXG4gICAgcHVibGljIHNldCBhY3RpdmVXaW5kb3dJZCAodmFsKSB7XG4gICAgICAgIHRoaXMucHJldmlvdXNBY3RpdmVXaW5kb3dJZCA9IHRoaXMuYWN0aXZlV2luZG93SWQ7XG5cbiAgICAgICAgdGhpcy5wcm92aWRlci5zZXRBY3RpdmVXaW5kb3dJZCh0aGlzLmlkLCB2YWwpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBvcGVuRmlsZVByb3RvY29sICh1cmw6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm92aWRlci5vcGVuRmlsZVByb3RvY29sKHRoaXMuaWQsIHVybCk7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIGNhblVzZURlZmF1bHRXaW5kb3dBY3Rpb25zICgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvdmlkZXIuY2FuVXNlRGVmYXVsdFdpbmRvd0FjdGlvbnModGhpcy5pZCk7XG4gICAgfVxuXG4gICAgcHVibGljIGlzUmVhZHkgKCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0dXMgPT09IEJyb3dzZXJDb25uZWN0aW9uU3RhdHVzLnJlYWR5IHx8XG4gICAgICAgICAgICB0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMub3BlbmVkIHx8XG4gICAgICAgICAgICB0aGlzLnN0YXR1cyA9PT0gQnJvd3NlckNvbm5lY3Rpb25TdGF0dXMuY2xvc2luZztcbiAgICB9XG59XG4iXX0=