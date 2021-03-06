const { Logger } = require("hns-logger-plugin");
const { Http } = require("hns-http-plugin");
const { Dao } = require("hns-dao-plugin");
const { Application } = require("hns-app");

exports.app = new Application();
var app = exports.app;
(async () => {
  try {
    app.loadConfig("loggerConfig", require("./config/logger.json"));
    app.logger = new Logger(app, app.get("loggerConfig"));
    app.logger.replaceConsole();

    app.loadConfig("daoConfig", require("./config/dao.json"));
    app.dao = new Dao(app, app.get("daoConfig"));
    await app.dao.init();

    app.loadConfig("httpConfig", require("./config/http.json"));
    app.http = new Http(app, app.get("httpConfig"));
    app.http.setExceptionHandler((req, res, e) => {
      let errString;
      if (typeof e == "string") {
        errString = e;
        console.error(e);
      } else {
        errString = e.message;
        console.setStack(e.stack).error(e.message);
      }

      res.json({
        code: 500,
        message: errString,
      });
    });

    app.http.start();

    app.loadConfig("ftConfig", require("./config/ft.json"));
    let ftConfig = app.get("ftConfig");

    const { FtMgr } = require("./domain/FtMgr");
    FtMgr.init(ftConfig);

    console.log("start completed");
  } catch (e) {
    console.error("start failed", e);
  }
})();
