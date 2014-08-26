/*************************
  SARAH-Plugin-ExtSpeak
  Author: Alban Vidal-Naquet
  Date: 24/07/2014
  Description:
    ExtSpeak Plugin for SARAH project (see http://encausse.wordpress.com/s-a-r-a-h/)
**************************/

/*****************************
  TODO LIST:
    -Plages horaires multiples pour Speak à implementer
    -Plages horaires multiples pour notify à implementer
    -Load/Save previous state
******************************/
var g_debug=0;
var loc=require("./customloc.js").init(__dirname);
var bf=require("./basicfunctions.js").init(function(){return g_debug;});

const gs_push_url       = "http://<SERVER>/sarah/push";
const gs_pushover_url   = "http://<SERVER>/sarah/pushover";
const gs_pushingbox_url = "http://<SERVER>/sarah/pushingbox";
const gs_notfifyMaxDelay= 120;

var   g_config;
var   g_SpeakTimeRange=new Array();
var   g_NotifyTimeRange=new Array();
var   g_repeat=0;
var   g_profile="";
var   g_notifyDate;

exports.init = function(SARAH)
{
	var config=SARAH.ConfigManager.getConfig();
	var patt=new RegExp("([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})");
    var res;
  
	config=config.modules.ExtSpeak;
    g_config=config;
    //SARAH.context.ExtSpeak=bf.LoadContext();
    res=patt.exec(g_config.SpeakTimeRange);
    // Extract Speak time range infos
    if (res!=null && res.length==5)
    {
        g_SpeakTimeRange.push(res[1]);
        g_SpeakTimeRange.push(res[2]);
        g_SpeakTimeRange.push(res[3]);
        g_SpeakTimeRange.push(res[4]);
    }
    res=patt.exec(g_config.NotifyTimeRange);
    // Extract Notify time range infos
    if (res!=null && res.length==5)
    {
        g_NotifyTimeRange.push(res[1]);
        g_NotifyTimeRange.push(res[2]);
        g_NotifyTimeRange.push(res[3]);
        g_NotifyTimeRange.push(res[4]);
    }
    g_notifyDate=new Date();
    g_notifyDate.setTime(0);
    // Create array for mobiles list ping
    var arr=g_config.PhoneIpList.split(",");
    if (typeof(SARAH.context.ExtSpeak)=="undefined" || SARAH.context.ExtSpeak==0)
    {
        SARAH.context.ExtSpeak={};
        SARAH.context.ExtSpeak.startInactivityDate=new Date();
        SARAH.context.ExtSpeak.startInactivityDate.setTime(0);
        SARAH.context.ExtSpeak.startIgnoreEventDate=new Date();
        SARAH.context.ExtSpeak.startIgnoreEventDate.setTime(0);
        SARAH.context.ExtSpeak.notify=0;
        SARAH.context.ExtSpeak.ping=new Array();
        SARAH.context.ExtSpeak_timer=new Array();
        SARAH.context.ExtSpeak.repeat=new Array();
        for (var i=0;i<parseInt(g_config.RepeatMax);i++)
            SARAH.context.ExtSpeak.repeat.push("");
        for (var i in arr)
        {
            SARAH.context.ExtSpeak.ping.push(0);
            SARAH.context.ExtSpeak_timer.push(setTimer(i, arr[i].trim(), SARAH)); 
        }
    }
    else
    {
        // Clear all previous timer
        for (var j in SARAH.context.ExtSpeak_timer)
            clearInterval(SARAH.context.ExtSpeak_timer[i]);
        SARAH.context.ExtSpeak_timer=new Array();
        // If not the same number of phone as previous then reset them
        if (parseInt(g_config.RepeatMax)!=SARAH.context.ExtSpeak.repeat.length)
        {
            SARAH.context.ExtSpeak.repeat=new Array();
            for (var i=0;i<parseInt(g_config.RepeatMax);i++)
                SARAH.context.ExtSpeak.repeat.push("");
        }
        if (arr.length!=SARAH.context.ExtSpeak.ping.length)
        {
            SARAH.context.ExtSpeak.ping=new Array();
            for (var i in arr)
            {
                SARAH.context.ExtSpeak.ping.push(0);
                SARAH.context.ExtSpeak_timer.push(setTimer(i, arr[i].trim(), SARAH)); 
            }
        }
    }
    // Kinect motion detect enabled ?
    if (g_config.EnableKinectMotionDetect=="1")
        exports.standBy=myStandBy;
    // Overload default settings by settings's one
    if (g_config.PingDelay!="")
        g_config.PingDelay=parseInt(g_config.PingDelay);
    if (g_config.LeaveDelay!="")
        g_config.LeaveDelay=parseInt(g_config.LeaveDelay);
    // Only do that for testing
    if ((g_debug&4)!=0)
        setInterval(function()
                    {
                        SARAH.speak("Ceci est un test");
                    },
                    30*1000);
}

exports.reload=function(SARAH)
{
    bf.SaveContext();
}

exports.release = function(SARAH)
{
    bf.SaveContext();
    loc.release();
}

function setPing(value, SARAH)
{
    for (var i in SARAH.context.ExtSpeak.ping)
        SARAH.context.ExtSpeak.ping[i]=value;
}

// If tts is a list of sentence separated with |, for example tts="bonjour|bonsoir|salut|ola"
// selectSentence will select randomly one of these and return choice
var selectSentence=function(tts)
{
    var r="";
	var choices=tts+"";
	var res = choices.split("|");
    // no choice ?
	if (res.length==1)
	  r=tts;
	else
	  r=res[Math.floor(Math.random()*res.length)];
    return r;
}

var ExtendedSpeak=function(str, async, SARAH)
{
    var res=0;
    var d=new Date();
    // RegExp to get the out of space RunStop plugin
    var patt=new RegExp("^([0-9]{0,3}:[0-9]{2}:[0-9]{2})$");
    var r=patt.exec(str);   
    var n=-1,s=-1;

    // If empty then call the original speak function
    if (str=="")
        return str;
    // Check if not a tts callback sended by 'RunStop' plugin; If it is, process it with standard speak function
    if (r!=null && r.length==2 && r[1]!="")
        return str;
    
    patt=new RegExp("^(\[[NS]*\]).*$");
    var res=patt.exec(str);
    if (res!=null && res.length==2)
    {
        switch(res[1])
        {
            case "[N]":
                n=1;
                s=0;
                break;
            case "[S]":
                s=1;
                n=0;
                break;
            case "[NS]":
            case "[SN]":
                n=1;
                s=1;
                break;
            case "[]":
                n=0;
                s=0;
                break;
            default:
                console.log("ExtSpeak: Unknow extspeak option '"+res[1]+"'");
                break;
        }
        str=str.replace(res[1], "");
    }
    
    // If multiple sentence choice, then choose one
    str=selectSentence(str);
    bf.debug(1, "ExtendedSpeak(\""+str+"\","+async+",SARAH)");
    // If in repeat mode then don't save what SARAH repeat
    if (g_repeat==0 && g_config.EnableRepeat=="1" && typeof(SARAH.context.ExtSpeak.repeat)!="undefined")
    {
        SARAH.context.ExtSpeak.repeat.pop();
        SARAH.context.ExtSpeak.repeat.unshift(str);
    }
    // Check if ping is active on mobiles
    var status=checkPing(SARAH);
    bf.debug(2, "InactivityDate="+(SARAH.context.ExtSpeak.startInactivityDate.getTime()==0?"---":SARAH.context.ExtSpeak.startInactivityDate));
    bf.debug(2, "IgnoreEventDate="+(SARAH.context.ExtSpeak.startIgnoreEventDate.getTime()==0?"---":SARAH.context.ExtSpeak.startIgnoreEventDate));
    bf.debug(2, "NotifyMode="+SARAH.context.ExtSpeak.notify+" date:"+(g_notifyDate.getTime()==0?"---":g_notifyDate));
    bf.debug(2, "EnableForceNotify="+g_config.EnableForceNotify);
    bf.debug(2, "EnableForceSpeak="+g_config.EnableForceSpeak);
    bf.debug(2, "isInTimeRange(Notify)="+isInTimeRange(d, g_NotifyTimeRange));
    bf.debug(2, "isInTimeRange(Speak)="+isInTimeRange(d,g_SpeakTimeRange));
    bf.debug(2, (status.nobody==false?"Device detected at home,":"No device detected at home,")+"(max:"+status.max*g_config.PingDelay+" seconds,min:"+status.min*g_config.PingDelay+" seconds)");
    bf.debug(2, "n="+n+" s="+s);
    // If no mobiles detected then be sure than the last motion detection was before the inactivity delay
    if (status.nobody==true && SARAH.context.ExtSpeak.startInactivityDate.getTime()>0 && d.getTime()<SARAH.context.ExtSpeak.startInactivityDate.getTime())
        // Check that we are not in ignore event period
        if (SARAH.context.ExtSpeak.startIgnoreEventDate.getTime()==0 || d.getTime()>SARAH.context.ExtSpeak.startIgnoreEventDate.getTime())
        {
            bf.debug(2, "Motion detected at home");
            status.nobody=false;
        }
    bf.debug(2, "Nobody="+status.nobody);
    // Check instant notify status
    var instant_notify=(SARAH.context.ExtSpeak.notify==2?true:(SARAH.context.ExtSpeak.notify==0?false:(SARAH.context.ExtSpeak.notify==1?(d.getTime()<g_notifyDate.getTime()?true:false):false)));
    if (n==-1 || n==1)
        // Need to send a notification ?
        if (n==1 || status.nobody==true || g_config.EnableForceNotify=="1" || (instant_notify==true && g_config.EnableInstantNotification=="1") || isInTimeRange(d, g_NotifyTimeRange)==true)
        {
            // Yes, so adapt string to http transfer (transform space in '+')
            var fstr=str.replace(/ /,"+");
            // Replace [name] section by last identified profile
            fstr=fstr.replace("[name]", g_profile);
            // send notification
            res=sendNotification(fstr);
        }
    // If one shot notify mode then clear it
    if (SARAH.context.ExtSpeak.notify==1)
    {
        SARAH.context.ExtSpeak.notify=0;
        g_notifyDate.setTime(0);
    }
    // If:
    //      someone is here, or no notification system setted, 
    //    AND
    //      force speak enabled, or in speak time range
    if (s==-1 || s==1)
        if (s==1 || 
		    ((status.nobody==false || res==-1) && (g_config.EnableForceSpeak=="1" || isInTimeRange(d, g_SpeakTimeRange)==true)))
            // Vocalize string
            return str;
    // Then no vocalisation 
    return false;
}

exports.speak=ExtendedSpeak;

var checkPing=function(SARAH)
{
    var phoneinactivitydelay=(60/g_config.PingDelay)*g_config.MinInactivityDelay;
    var res={'min': -1, 'max': -1, 'nobody': true};
    
    for (var i in SARAH.context.ExtSpeak.ping)
    {
        bf.debug(2, "ping["+i+"]="+SARAH.context.ExtSpeak.ping[i]);
        if (res.min==-1 || res.min>SARAH.context.ExtSpeak.ping[i])
            res.min=SARAH.context.ExtSpeak.ping[i];
        if (res.max==-1 || res.max<SARAH.context.ExtSpeak.ping[i])
            res.max=SARAH.context.ExtSpeak.ping[i];
        if (SARAH.context.ExtSpeak.ping[i]<phoneinactivitydelay)
            res.nobody=false;
    }
    return res;
}

function sendNotification(str)
{
    var url="";
    switch (g_config.NotificationPluginName)
    {
        case "push":
            var profile=g_config.PushPluginDefaultUser;
            if (g_config.PushUseProfilId=="1" && g_profile!="")
                profile=g_profile;
            url=gs_push_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?silent=1&who="+profile+"&msg="+str;
            break;
        case "pushingbox":
            url=gs_pushingbox_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?tts="+str+"&quiet=1";
            break;
        case "pushover":
            url=gs_pushover_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?push="+str;
            break;
        default:
            console.log("ExtSpeak: Unknow notification system, please review plugin settings");
            return -1;
            break;
    }
    // If something to send, then send it now
    if (url!="")
    {
        var request = require('request');
        request(    { 'uri' : url }, 
                    function (err, response, body)
                    {
                        if (err!=0)
                            console.log("ExtSpeak: Error while sending notification ("+err+")");
                    }
                );
    }
    return 0;
}

var myStandBy = function(motion, data, SARAH)
{
    var d=new Date();
    
    bf.debug(1, "myStandBy("+motion+","+JSON.stringify(data)+")");
    data.silent="1";
    data.mode="";
    // If in event ignore period, don't do anything
    if (SARAH.context.ExtSpeak.startIgnoreEventDate.getTime()!=0 && d.getTime()<SARAH.context.ExtSpeak.startIgnoreEventDate.getTime())
        return ;
    switch(motion)
    {
        case true:
            var status=checkPing(SARAH);
            if (SARAH.context.ExtSpeak.startInactivityDate.getTime()>0 && d.getTime()>SARAH.context.ExtSpeak.startInactivityDate.getTime() && status.nobody==true)
                if (g_config.EnableMotionNotify=="1")
                    sendNotification(loc.getLocalString("IDMOTIONDETECT"));
            data.mode="detectactivity";
            break;
        case false:
            data.mode="detectidle";
            break;        
    }
    // If something to do then do it now
    if (data.mode!="")
        action(data, function(){}, SARAH.ConfigManager.getConfig(), SARAH);
}

// Check if date is in range
function isInTimeRange(d, TimeArray)
{
    var b=new Date();
    var e=new Date();
    
    if (TimeArray.length!=4)
        return false;
    b.setHours(TimeArray[0]);
    b.setMinutes(TimeArray[1]);
    b.setSeconds(0);
    e.setHours(TimeArray[2]);
    e.setMinutes(TimeArray[3]);
    e.setSeconds(0);
    if (e.getTime()<b.getTime())
        e.setTime(e.getTime()+(24*60*60*1000));
    if (d.getTime()>=b.getTime() && d.getTime()<=e.getTime())
        return true;
    return false;
}


// Function to monitor mobiles pings
var setTimer=function(index, ping_addr, SARAH)
{
    return setInterval(function()
                        {
                            var d=new Date();
                            
                            // Ignore event period ?
                            if (SARAH.context.ExtSpeak.startIgnoreEventDate.getTime()!=0 && d.getTime()<SARAH.context.ExtSpeak.startIgnoreEventDate.getTime())
                                // Yes so skip ping test
                                return ;
                            // Do ping
                            var exec = require('child_process').exec;
                            var ping = "ping -n 1 " + ping_addr;
                            var child = exec(ping, function(err, stdout, stderr) 
                                                    {
                                                        // Ping is KO ?     
                                                        if (stdout.search("Impossible")==-1)
                                                            // Ping is responding, so save it
                                                            SARAH.context.ExtSpeak.ping[index]=0;
                                                        else
                                                            // Yes, so save new failed ping
                                                            SARAH.context.ExtSpeak.ping[index]+=1;
                                                    });
                        },
                        g_config.PingDelay*1000);
}

// Repeat 1 to 5 last SARAH vocalization
function repeat(mode, SARAH)
{
    g_repeat=1;
    // Repeat enabled ?
    if (g_config.EnableRepeat!="1")
        SARAH.speak(loc.getLocalString("IDREPEATDISABLED"));
    else
    {
        var count=0;
        for (var i=(mode-1);i>=0;i--)
        {
            if (SARAH.context.ExtSpeak.repeat[i]!="")
            {
                count++;
                SARAH.speak(SARAH.context.ExtSpeak.repeat[i]);
            }
        }
        if (count==0 && mode>0)
            SARAH.speak(loc.getLocalString("IDCANTREMEMBER"));
    }
    g_repeat=0;
}


var action = function(data, callback, config, SARAH)
{
	var config=config.modules.ExtSpeak;
    var comment="";
    var d=new Date();
    var phoneinactivitydelay=(60/g_config.PingDelay)*g_config.MinInactivityDelay;
    
    bf.debug(1, JSON.stringify(data));
    if (typeof(data.profile)!="undefined" && data.profile!="")
        g_profile=data.profile;
    switch (data.mode)
    {
        case "notify":
            // instant notify mode
            if (g_config.EnableInstantNotification=="1")
            {
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("OKLETSGO"));
                setTimeout(function(){SARAH.context.ExtSpeak.notify=1;g_notifyDate=new Date();g_notifyDate.setTime(g_notifyDate.getTime()+(gs_notfifyMaxDelay*1000))}, 2*1000);
            }
            else
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("IDNOINSTANTNOTIFY"));                
            break;
        case "notify_b":
            // instant notify period begin 
            if (g_config.EnableInstantNotification=="1")
            {
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("OKLETSGO"));
                setTimeout(function(){SARAH.context.ExtSpeak.notify=2;}, 2*1000);
            }
            else
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("IDNOINSTANTNOTIFY"));                
            break;
        case "notify_e":
            // instant notify period end
            if (g_config.EnableInstantNotification=="1")
            {
                SARAH.context.ExtSpeak.notify=0;
                g_notifyDate.setTime(0);
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("OKLETSGO"));
            }
            else
                if (typeof(data.silent)=="undefined" || data.silent!="1")
                    SARAH.speak(loc.getLocalString("IDNOINSTANTNOTIFY"));                
            break;
        case "repeat":
            repeat(1, SARAH);
            break;
        case "repeat2":
            repeat(2, SARAH);
            break;
        case "repeat3":
            repeat(3, SARAH);
            break;
        case "repeat4":
            repeat(4, SARAH);
            break;
        case "repeat5":
            repeat(5, SARAH);
            break;
        case "forcespeak":
            g_config.EnableForceSpeak=data.value.toString();
            break;
        case "forcenotify":
            g_config.EnableForceNotify=data.value.toString();
            break;
        case "kinectmotiondetect":
            g_config.EnableKinectMotionDetect=data.value.toString();
        case "motionnotify":
            g_config.EnableMotionNotify=data.value.toString();
            break;
        case "activitynow":      
            setPing(0, SARAH);
            SARAH.context.ExtSpeak.startInactivityDate.setTime(0);
            comment=loc.getLocalString("OKLETSGO");
            break;
        case "idlenow":
            if (typeof(data.silent)=="undefined" || data.silent!="1")
                SARAH.speak(loc.getLocalString("OKLETSGO"));
            setTimeout(function()
                      {
                        setPing(phoneinactivitydelay, SARAH);
                        SARAH.context.ExtSpeak.startIgnoreEventDate.setTime(d.getTime()+(g_config.LeaveDelay*1000));
                        SARAH.context.ExtSpeak.startInactivityDate.setTime(d.getTime());
                      }, 2*1000);
            break;
        case "detectactivity":
            if (SARAH.context.ExtSpeak.startIgnoreEventDate.getTime()!=0 && d.getTime()<SARAH.context.ExtSpeak.startIgnoreEventDate.getTime())
                break;
            else
            {
                setPing(0, SARAH);
                SARAH.context.ExtSpeak.startInactivityDate.setTime(0);
            }
            break;
        case "detectidle":
            if (SARAH.context.ExtSpeak.startInactivityDate.getTime()==0)
                SARAH.context.ExtSpeak.startInactivityDate.setTime(d.getTime()+g_config.MinInactivityDelay*60*1000);
            if (d.getTime()>=SARAH.context.ExtSpeak.startInactivityDate.getTime())
                setPing(phoneinactivitydelay, SARAH);
           break;
    }
    if (typeof(data.silent)!="undefined" && data.silent=="1")
        comment="";
	callback({'tts': comment});
	return 0;
}

exports.action=action;
