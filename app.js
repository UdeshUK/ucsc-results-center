// Logger Configurations
let log = require('perfect-logger');
let credentials = require('./modules/credentials');
const sysconfig = require('./modules/configurations');
let mysql = require('./modules/database');

log.setLogDirectory(sysconfig.logDirectory);
log.setLogFileName("ucscresultcenter-web");
if (!credentials.isDeployed){
    log.maintainSingleLogFile();
}
log.setApplicationInfo({
    name: "UCSC Results Center",
    banner: "Copyright 2019 Team whileLOOP",
    version: "1.0"
});
log.addStatusCode("mail", "MAIL", false, '', true);
log.addStatusCode("crit_nodb", "CRIT", false, 'red');
log.addStatusCode("fbmsg", "FBMS", false, '', true);
log.addStatusCode("socket", "SOCK", false, '', true);
log.setMaximumLogSize(500000);
log.setTimeZone("Asia/Colombo");
log.enableVirtualLogs();
log.initialize();

//*************************************************************************************************

const port = process.env.PORT || 3000;
let postman = require('./modules/postman');

const express = require('express');
const path = require('path');
const app = express();
const fs = require('fs');
const socketIO = require('./index');
const bodyParser = require('body-parser');
const messenger = require('./modules/messenger');

function loggerCallback(data = {}){
    if (data.details && data.details.skipFacebookMessenger === true)
        return;
    
    if (data.code === 'WARN' || data.code === 'CRIT'){
        messenger.sendToEventSubscribers('system_warn_err_thrown', `Event Raised: ${data.code}\n${data.message}`);
    }
}

function logDatabaseCallback(data){

    let dataJSON = "";
    if (data.details){
        log.writeData(data.details);
    }

    if (!mysql.connectedToDatabase)
        return;

    if (data.details && typeof data.details !== "string"){
        dataJSON = JSON.stringify(data.details);

    }else{
        dataJSON = data.details || "";
    }
    dataJSON = dataJSON.substr(0, 2900);

    if (!credentials.isDeployed){
        return;
    }

    const query = "INSERT INTO `log` (`date`, `time`, `code`, `message`, `data`) VALUES (?, ?, ?, ?, ?);";
    mysql.ping(function (err) {
        if (err){
            log.writeData("No database connection for database callback");
            log.writeData(err);
        }else{
            mysql.query(query, [data.date, data.time, data.code, data.message, dataJSON], function (err, payload) {
                if (err){
                    log.crit_nodb("Failed to send log event to database");
                }
            })
        }
    });

}

log.setCallback(loggerCallback);
log.setDatabaseCallback(logDatabaseCallback);
messenger.alertDeveloper(`Initializing UCSC Results Center Web Server: ${log.getLogFileName()}`);

let privateKey;
let certificate;
let httpsCredentials;

// Global Variables
global.maintananceMode = {
    event: 'Server maintenance mode',
    status: false,
    message: 'System under maintenance',
    adminName: 'Administrator'
};

global.monitoring = {
    status: "Offline",
    lastPing: + new Date(),
    online: false,
    notResponding: false,
    forceScan: false
};

// Setup Logger
if (credentials.isDeployed){
    privateKey  = fs.readFileSync(credentials.ssl.key, 'utf8');
    certificate = fs.readFileSync(credentials.ssl.cert, 'utf8');
    httpsCredentials = {key: privateKey, cert: certificate};
    log.info("Server initializing in Production Mode")
}else{
    log.info("Server initializing in Development Mode")
}

privacyPolicy  = fs.readFileSync('privacy.txt', 'utf8');

// Setup Express
const http = require('http').Server(app);
const https = require('https').Server(httpsCredentials, app);
app.set('views', __dirname + '/');
app.engine('html', require('ejs').renderFile);
http.listen(port, function(){
    log.info('Server started and listening on PORT ' + port);
});
// Setup HTTPS
if (credentials.isDeployed){
    https.listen(443, function(){
        log.info('Server started and listening on PORT ' + 443);
    });
}

// Route Imports and Config
app.use(bodyParser.json());
const user = require('./routes/user');
const admin = require('./routes/admin/admin');
const apiV1 = require('./routes/api-v1');
const statistics = require('./routes/statistics');
const webhook = require('./routes/webhook/fb-webhook');
app.use('/user', user);
app.use('/admin', admin);
app.use('/v1.0', apiV1);
app.use('/statistics', statistics);
app.use('/webhook', webhook);

// Static Files
app.use('/public',express.static(path.join(__dirname, 'public')));
app.use('/cdn',express.static(path.join(__dirname, 'node_modules')));

// Routing
app.get('/', function(req, res) {
    // Redirect HTTPS traffic to HTTPS on production environment
    if (credentials.isDeployed && (!req.secure || req.headers.host !== 'www.ucscresult.com')){
        res.writeHead(302, {
            'Location': 'https://www.ucscresult.com'
        });
        res.end();
        return;
    }
    if (!global.maintananceMode.status){
        res.render('templates/web/index.html');
    }else {
        res.render('templates/web/maintenance.ejs', global.maintananceMode);
    }
});

app.get('/status', function(req, res) {
    const exec = require("child_process").exec;
    exec("pm2 status", (error, stdout, stderr) => {
        res.render('templates/web/pm2status.ejs', {status: stdout});
    })
});

app.get('/privacy', function(req, res) {
    res.send(privacyPolicy);
});

// Database disconnection endpoint for testing purposes
app.get('/disconnect', function (req, res) {
    if (!credentials.isDeployed){
        mysql.connectedToDatabase = false;
        mysql.end(function(err) {
            res.send(err || {});
        });
    }else{
        res.status(400).send("Cannot disconnect in production mode");
    }
});


app.all('/*', function (req, res) {
    log.debug(`Access unknown route: ${req.originalUrl}. IP: ${req.headers['x-forwarded-for'] || req.connection.remoteAddress}. METHOD: ${req.method}`);
    res.status(404).render('templates/web/not-found.html');
});


if (credentials.isDeployed || true){
    const interval = setInterval(function () {
        if (!mysql.connectedToDatabase)
            return;

        messenger.sendToEventSubscribers('system_restart',
            'Application Status Update:\n\nServer started: ' + new Date(),
            "APPLICATION_UPDATE");
        clearInterval(interval);
    }, 100);
}


module.exports = credentials.isDeployed ? https : http;