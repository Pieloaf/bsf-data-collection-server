import express from 'express';
import https from "https";
import axios from 'axios';
import { promises as fs, readFileSync } from 'fs';
import { inspect } from 'util';
import * as bodyParser from 'body-parser';
import { spawn } from 'child_process';

const app = express();
axios.defaults.baseURL = "http://tbs-dev-live.stoicstudio.com/services"
app.disable('etag'); // disables caching responses

const ServerOptions = {
    key: readFileSync('/etc/letsencrypt/live/pieloaf.com/privkey.pem', 'utf8'),
    cert: readFileSync('/etc/letsencrypt/live/pieloaf.com/fullchain.pem', 'utf8'),
};

app.use(bodyParser.text({
    type: ['json', 'text']
}));

const sendWelcome: string[] = [];

const formatReqRes = (req: any, body: any, res: string) => {
    let service = (req.url as String).match(/\/(.*)\//)?.[1].toUpperCase();

    return inspect({
        URL: req.url,
        METHOD: req.method,
        SERVICE: service,
        TIMESTAMP: new Date().getTime(),
        REQUEST: body,
        RESPONSE: res
    }, { depth: 10 })
};

const formatFileHeader = (data: any) => {
    return `
data = [
{
    user_id: ${data.user_id},
    display_name: '${data.display_name}'
}`
}

const fmtDate = (): string => {
    let datePattern: RegExp = /(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2})/;
    let [, DD, MM, YYYY, h, m]: any = datePattern.exec(new Date().toLocaleString('en-GB'));
    return `${YYYY}-${MM}-${DD}_${h}-${m}`;
}

const welcomeMsg = {
        class: "tbs.srv.chat.ChatMsg",
        msg: "Thank you for contributing to the development of the factions custom server <3",
        room: "global",
        user: 0,
        username: "[Server]"
}

const handleLogout = async (session_key: string) => {
    await fs.appendFile(`./sessions/${session_key}.js`, "];\nexport { data };");
    await fs.rename(`./sessions/${session_key}.js`, `./sessions/${fmtDate()}_${session_key}.js`)
    let process = spawn('bash', ['./pushSession.sh', session_key]);
    process.on('exit', (code: number) => {
        console.log(`Session push exited with code: ${code}`);
    });
}

app.use('/services', async (req, res) => {
    let body: any;
    if (typeof req.body === 'string') {
        try {
            body = JSON.parse(req.body)
        } catch (err) {
            body = req.body ? req.body : null
        }
    }

    //=== FORWARDING ===//
    // forward data to offical server and respond
    let server_res;
    try {
        server_res = await axios({
            method: req.method,
            url: req.url,
            data: body
        });
    } catch (error) {
        let err_res = (error as any).response
        res.status = err_res.status;
        res.send(err_res.data);
        return;
    }
    
    // get session key from url
    let session_key = req.path.substring(req.path.lastIndexOf("/") + 1)
    {
        let idx = sendWelcome.indexOf(session_key)
        if (idx !== -1 && server_res.data.constructor === Array) {
            server_res.data.push(welcomeMsg);
            sendWelcome.splice(idx, 1);
        }
    }
    res.send(server_res.data);

    //=== LOGGING ===//
    // ignore request if it fails
    if (server_res.status !== 200) return;

    if (req.path.startsWith("/session/steam/overlay/") ||
        req.path.startsWith("/chat/")) return;

    if (req.path.startsWith("/auth/login")) {
        await fs.writeFile(`./sessions/${server_res.data.session_key}.js`, formatFileHeader(server_res.data))
        sendWelcome.push(server_res.data.session_key);
        return;
    }

    if (server_res.data.constructor === Array)
        server_res.data = (server_res.data as any[]).filter(msg => msg.class !== "tbs.srv.chat.ChatMsg")

    if (server_res.data.length === 0)
        server_res.data = null

    // ignore all the server pings with no data
    if (req.path === `/game/${session_key}` && (!server_res.data || server_res.data?.length === 0)) return;

    // format data string
    let data = formatReqRes(req, body, server_res.data);

    if (req.url.startsWith("/auth/logout/")) {
        handleLogout(session_key);
    } else await fs.appendFile(`./sessions/${session_key}.js`, `, ${data}`)

});


app.get("/", async (_, res) => {
    // I know this is ugly af but I was feeling lazy and this is where laziness ended up 🙃
    // this is primarily for logging requests, not for a fancy looking webpage :P
    res.send(`
<html>
    <head>
    <meta content="Banner Saga Factions Custom Server Data Collection" property="og:title" />
    </head>
    <body style="font-family: Trebuchet MS;">
        <h3>Thank you for supporting the development of the Banner Saga Factions Custom Community Server! <br><br>
        If you would like to allow you game data to be collected to help development please add: <br> 
        <code style="
        background-color: #b02e11;
        color: #fff9f2;
        font-weight: bold;">--server https://bsf.pieloaf.com</code> as a launch argument in steam.</h3>
        <h4>Submit Feedback:</h4>
        <textarea placeholder="Enter feedback here..." style="height: 124px; width: 631px;"></textarea>
        <button onClick="(async e =>{
            textarea = document.querySelector('textarea');
            if (textarea.value === '') return;
            try {
                const response = await fetch('https://bsf.pieloaf.com/feedback', {
                    method: 'post',
                    body: textarea.value
                });
                
                console.log('Completed!', response);
                textarea.style.background = '';
                textarea.value = '';
            } catch(err) {
                console.error(\`Error: \${err}\`);
                textarea.style.background = 'red';
            }
        })()"> Submit </button>
        <p>For more information on the data collected please see this <a href="https://youtu.be/ne_xvSNU6Eo">video</a><br>
        The source code for the server can be found <a href="https://github.com/Banner-Saga-Factions/BSF-Data-Collection-Server">here</a></p>
        <img src="https://cdn.discordapp.com/attachments/944279686882660413/1070781835971399770/steam_W3b9FcRJqF.gif" style="width: 950px"/>
    </body>
</html>`);
});

app.post("/feedback", async (req, res) => {
    await fs.appendFile(`feedback.txt`, `${req.body}\n-----\n`);
    res.sendStatus(200);
})

https.createServer(ServerOptions, app).listen(8082, () => {
    console.log("Express server listening on port " + 8082);
});
