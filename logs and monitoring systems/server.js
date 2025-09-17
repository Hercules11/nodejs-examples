// server.js
const http = require("http");
const fs = require("fs");
const { performance } = require("perf_hooks");

// ====== 日志系统（分级写入不同文件） ======
class Logger {
    constructor(baseDir = ".") {
        this.files = {
            info: `${baseDir}/info.log`,
            warn: `${baseDir}/warn.log`,
            error: `${baseDir}/error.log`,
            all: `${baseDir}/all.log`,
        };
    }

    log(level, message, context = {}) {
        const time = new Date().toISOString();
        const logMsg = `[${time}] [${level.toUpperCase()}] ${message} ${JSON.stringify(context)}\n`;

        // 控制台输出
        if (level === "error") {
            console.error(logMsg.trim());
        } else if (level === "warn") {
            console.warn(logMsg.trim());
        } else {
            console.log(logMsg.trim());
        }

        // 写入对应文件
        const filePath = this.files[level];
        if (filePath) {
            fs.appendFile(filePath, logMsg, (err) => {
                if (err) console.error("日志写入失败", err);
            });
        }

        // 统一写入 all.log
        fs.appendFile(this.files.all, logMsg, (err) => {
            if (err) console.error("all.log 写入失败", err);
        });
    }

    info(msg, ctx) { this.log("info", msg, ctx); }
    warn(msg, ctx) { this.log("warn", msg, ctx); }
    error(msg, ctx) { this.log("error", msg, ctx); }
}

const logger = new Logger("./logs");

// 确保日志目录存在
if (!fs.existsSync("./logs")) {
    fs.mkdirSync("./logs");
}

// ====== 简单监控系统 ======
const metrics = {
    totalRequests: 0,
    totalErrors: 0,
    totalResponseTime: 0,
    averageResponseTime: 0,
};

function updateMetrics(duration, isError = false) {
    metrics.totalRequests++;
    if (isError) metrics.totalErrors++;
    metrics.totalResponseTime += duration;
    metrics.averageResponseTime = metrics.totalResponseTime / metrics.totalRequests;
}

// ====== 中间件处理函数 ======
function requestHandler(req, res) {
    const start = performance.now();
    const requestId = Math.random().toString(36).slice(2, 10);

    logger.info("Incoming request", { method: req.method, url: req.url, requestId });

    // 处理 /metrics 接口
    if (req.url === "/metrics") {
        const body = JSON.stringify(metrics, null, 2);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        updateMetrics(performance.now() - start);
        logger.info("Metrics served", { requestId });
        return;
    }

    // 模拟一个错误路由
    if (req.url === "/error") {
        const errMsg = "Simulated server error!";
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(errMsg);
        const duration = performance.now() - start;
        updateMetrics(duration, true);
        logger.error(errMsg, { requestId, duration });
        return;
    }

    // 正常路由
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello, World!");
    const duration = performance.now() - start;
    updateMetrics(duration);
    logger.info("Request completed", { requestId, duration });
}

// ====== 启动服务器 ======
const server = http.createServer(requestHandler);

server.listen(3000, () => {
    logger.info("Server started on port 3000");
});
