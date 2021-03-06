"use strict";

var crypto = require("crypto"), clusterwsUws = require("clusterws-uws"), HTTP = require("http"), HTTPS = require("https"), cluster = require("cluster");

function random(s, e) {
    return Math.floor(Math.random() * (e - s + 1)) + s;
}

function logError(s) {
    return process.stdout.write(`[31mError PID ${process.pid}:[0m  ${s}\n`);
}

function logReady(s) {
    return process.stdout.write(`[32m✓ ${s}[0m\n`);
}

function logWarning(s) {
    return process.stdout.write(`[33mWarning PID ${process.pid}:[0m ${s}\n`);
}

function isFunction(s) {
    return "[object Function]" === {}.toString.call(s);
}

function generateKey(s) {
    return crypto.randomBytes(s).toString("hex");
}

class EventEmitter {
    constructor() {
        this.events = {};
    }
    on(s, e) {
        if (!isFunction(e)) return logError("Listener must be a function");
        this.events[s] = e;
    }
    emit(s, ...e) {
        const t = this.events[s];
        t && t(...e);
    }
    exist(s) {
        return !!this.events[s];
    }
    removeEvent(s) {
        delete this.events[s];
    }
    removeEvents() {
        this.events = {};
    }
}

class Socket {
    constructor(s, e) {
        this.worker = s, this.socket = e, this.id = generateKey(10), this.emitter = new EventEmitter(), 
        this.channels = {}, this.onPublish = ((s, e) => {
            this.send(s, e, "publish");
        }), this.socket.on("message", s => {
            try {
                decode(this, JSON.stringify(s), this.worker.options);
            } catch (s) {
                logError(s);
            }
        }), this.socket.on("close", (s, e) => {
            for (const s in this.channels) this.channels[s] && this.worker.wss.unsubscribe(s, this.id);
            this.emitter.emit("disconnect", s, e), this.emitter.removeEvents();
        }), this.socket.on("error", s => {
            if (!this.emitter.exist("error")) return logError(s), this.socket.terminate();
            this.emitter.emit("error", s);
        });
    }
    on(s, e) {
        this.emitter.on(s, e);
    }
    send(s, e, t = "emit") {
        this.socket.send(encode(s, e, t, this.worker.options));
    }
    disconnect(s, e) {
        this.socket.close(s, e);
    }
    terminate() {
        this.socket.terminate();
    }
}

function encode(s, e, t, r) {
    "system" === t && r.encodeDecodeEngine && (e = r.encodeDecodeEngine.encode(e));
    const o = {
        emit: [ "e", s, e ],
        publish: [ "p", s, e ],
        system: {
            configuration: [ "s", "c", e ]
        }
    }, i = JSON.stringify({
        "#": o[t][s] || o[t]
    });
    return r.useBinary ? Buffer.from(i) : i;
}

function decode(s, e, t) {
    let [r, o, i] = e["#"];
    switch ("s" !== r && t.encodeDecodeEngine && (i = t.encodeDecodeEngine.decode(i)), 
    r) {
      case "e":
        return s.emitter.emit(o, i);

      case "p":
        return s.channels[o] && s.worker.wss.publish(o, i, s.id);

      case "s":
        const e = s.channels[i];
        "s" !== o || e || (s.channels[i] = 1, s.worker.wss.subscribe(i, s.id, s.onPublish)), 
        "u" === o && e && (delete s.channels[i], s.worker.wss.unsubscribe(i, s.id));
    }
}

class Channel {
    constructor(s, e, t) {
        this.channelName = s, this.subs = {}, this.subsIds = [], this.messagesBatch = [], 
        this.subscribe(e, t);
    }
    publish(s, e) {
        this.messagesBatch.push({
            id: s,
            message: e
        });
    }
    subscribe(s, e) {
        this.subsIds.push(s), this.subs[s] = e;
    }
    unsubscribe(s) {
        delete this.subs[s], this.subsIds.splice(this.subsIds.indexOf(s), 1), this.subsIds.length || (this.subs = {}, 
        this.subsIds = [], this.messagesBatch = [], this.action("destroy", this.channelName));
    }
    flush() {
        const s = this.subsIds.length, e = this.messagesBatch.length;
        if (!e) return;
        for (let t; t < s; t++) {
            const s = this.subsIds[t], r = [];
            for (let t = 0; t < e; t++) this.messagesBatch[t].id !== s && r.push(this.messagesBatch[t].message);
            r.length && this.subs[s](this.channelName, r);
        }
        const t = [];
        for (let s = 0, r = e; s < r; s++) t.push(this.messagesBatch[s].message);
        this.action("publish", this.channelName, t), this.messagesBatch = [];
    }
    unfilteredFlush(s) {
        for (let e = 0, t = this.subsIds.length; e < t; e++) this.subs[this.subsIds[e]](s);
    }
    action(s, e, t) {}
}

class BrokerClient {
    constructor(s) {
        this.url = s, this.attempts = 0, this.createSocket();
    }
    publish(s) {
        return this.socket.readyState === this.socket.OPEN && (this.socket.send(s), !0);
    }
    createSocket() {
        this.socket = new clusterwsUws.WebSocket(this.url), this.socket.on("open", () => {
            this.attempts = 0, this.attempts > 1 && logReady(`Reconnected to the Broker: ${this.url}`);
        }), this.socket.on("error", s => {
            (this.attempts > 0 && this.attempts % 10 == 0 || 1 === this.attempts) && logWarning(`Can not connect to the Broker: ${this.url} (reconnecting)`), 
            this.socket = null, this.attempts++, setTimeout(() => this.createSocket(), random(1e3, 2e3));
        }), this.socket.on("close", (s, e) => {
            if (this.socket = null, this.attempts++, 1e3 === s) return logWarning(`Disconnected from Broker: ${this.url} (code ${s})`);
            logWarning(`Disconnected from Broker: ${this.url} (reconnecting)`), setTimeout(() => this.createSocket(), random(1e3, 2e3));
        });
    }
}

class WSServer extends EventEmitter {
    constructor(s, e) {
        super(), this.options = s, this.channels = {}, this.middleware = {}, this.nextBrokerId = 0;
        for (let s = 0; s < this.options.brokers; s++) this.brokers.push(new BrokerClient(`ws://127.0.0.1:${this.options.brokersPorts[s]}/?token=${e}`));
        this.channelsLoop();
    }
    setMiddleware(s, e) {
        this.middleware[s] = e;
    }
    publish(s, e, t) {
        this.channels[s] && this.channels[s].publish(t, e);
    }
    subscribe(s, e, t) {
        if (this.channels[s]) this.channels[s].subscribe(e, t); else {
            const r = new Channel(s, e, t);
            r.action = this.actionsFromChannel, this.channels[s] = r;
        }
    }
    unsubscribe(s, e) {
        this.channels[s].unsubscribe(e);
    }
    broadcastMessage() {}
    actionsFromChannel(s, e, t) {
        switch (s) {
          case "destroy":
            delete this.channels[e];
            break;

          case "publish":
            let r = 0, o = !1;
            const i = Buffer.from(`${e}%${JSON.stringify(t)}`), n = this.brokers.length;
            for (;!o && r < 2 * n; ) this.nextBrokerId >= n && (this.nextBrokerId = 0), o = this.brokers[this.nextBrokerId].publish(i), 
            r++, this.nextBrokerId++;
        }
    }
    channelsLoop() {
        setTimeout(() => {
            for (const s in this.channels) this.channels[s] && this.channels[s].flush();
            this.channelsLoop();
        }, 10);
    }
}

class Worker {
    constructor(s, e) {
        this.options = s, this.wss = new WSServer(this.options, e), this.server = this.options.tlsOptions ? HTTPS.createServer(this.options.tlsOptions) : HTTP.createServer();
        const t = new clusterwsUws.WebSocketServer({
            server: this.server,
            verifyClient: (s, e) => {}
        });
        t.on("connection", s => {
            this.wss.emit("connection", new Socket(this, s));
        }), t.startAutoPing(this.options.pingInterval, !0), this.server.on("error", s => {
            logError(`${s.stack || s}`), process.exit();
        }), this.server.listen(this.options.port, this.options.host, () => {
            this.options.worker.call(this), process.send({
                event: "READY",
                pid: process.pid
            });
        });
    }
}

function masterProcess(s) {
    let e = !1;
    const t = [], r = [], o = generateKey(20), i = generateKey(20);
    if (s.horizontalScaleOptions && s.horizontalScaleOptions.masterOptions) n("Scaler", -1); else for (let e = 0; e < s.brokers; e++) n("Broker", e);
    function n(c, h) {
        const a = cluster.fork();
        a.on("message", o => {
            if ("READY" === o.event) {
                if (e) return logReady(`${c} ${h} PID ${o.pid} has been restarted`);
                switch (c) {
                  case "Broker":
                    if (t[h] = ` Broker on: ${s.brokersPorts[h]}, PID ${o.pid}`, !t.includes(void 0) && t.length === s.brokers) for (let e = 0; e < s.workers; e++) n("Worker", e);
                    break;

                  case "Worker":
                    r[h] = `    Worker: ${h}, PID ${o.pid}`, r.includes(void 0) || r.length !== s.workers || (e = !0, 
                    logReady(` Master on: ${s.port}, PID ${process.pid} ${s.tlsOptions ? "(secure)" : ""}`), 
                    t.forEach(logReady), r.forEach(logReady));
                    break;

                  case "Scaler":
                    for (let e = 0; e < s.brokers; e++) n("Broker", e);
                }
            }
        }), a.on("exit", () => {
            logError(`${c} ${h} has exited`), s.restartWorkerOnFail && (logWarning(`${c} ${h} is restarting \n`), 
            n(c, h));
        }), a.send({
            processId: h,
            processName: c,
            serverId: o,
            internalSecurityKey: i
        });
    }
}

function workerProcess(s) {
    process.on("message", e => {
        switch (e.processName) {
          case "Worker":
            return new Worker(s, e.internalSecurityKey);

          case "Broker":
            process.send({
                event: "READY",
                pid: process.pid
            });
        }
    }), process.on("uncaughtException", s => {
        logError(`${s.stack || s}`), process.exit();
    });
}

class ClusterWS {
    constructor(s) {
        if (this.options = {
            port: s.port || (s.tlsOptions ? 443 : 80),
            host: s.host,
            worker: s.worker,
            workers: s.workers || 1,
            brokers: s.brokers || 1,
            useBinary: s.useBinary,
            tlsOptions: s.tlsOptions,
            pingInterval: s.pingInterval || 2e4,
            brokersPorts: s.brokersPorts || [],
            encodeDecodeEngine: s.encodeDecodeEngine,
            restartWorkerOnFail: s.restartWorkerOnFail,
            horizontalScaleOptions: s.horizontalScaleOptions
        }, !this.options.brokersPorts.length) for (let s = 0; s < this.options.brokers; s++) this.options.brokersPorts.push(s + 9400);
        return isFunction(this.options.worker) ? this.options.brokers !== this.options.brokersPorts.length ? logError("Number of broker ports should be the same as number of brokers") : void (cluster.isMaster ? masterProcess(this.options) : workerProcess(this.options)) : logError("Worker must be provided and it must be a function");
    }
}

module.exports = ClusterWS; module.exports.default = ClusterWS;
