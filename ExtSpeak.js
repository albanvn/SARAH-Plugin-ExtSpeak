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
******************************/
var g_debug=1;

var loc=require("./customloc.js").init(__dirname);
var bf=require("./basicfunctions.js").init(function(){return g_debug;});

const gs_push_url      = "http://<SERVER>/sarah/push";
const gs_pushover_url  = "http://<SERVER>/sarah/pushover";
const gs_pushingbox_url= "http://<SERVER>/sarah/pushingbox";

// Ping delay in seconds
const gs_pingDelay=20;
// Delay while ignoring ping/motion detect/exterior events in seconds (while leaving the house for example)
const gs_ignoreEventDelay=120;

var   g_config;
var   g_startInactivityDate=new Date();
var   g_startIgnoreEventDate=new Date();
var   g_ping=new Array();
var   g_SpeakTimeRange=new Array();
var   g_NotifyTimeRange=new Array();
var   g_lastSpeakContent=new Array("","","","","");
var   g_repeat=0;
var   g_notify=0;
var   g_profile="";

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
    var url="";
    var nobody=true;
    var d=new Date();
    var phoneinactivitydelay=(60/gs_pingDelay)*g_config.MinInactivityDelay;

    // If empty then call the original speak function
    if (str=="")
        return str;
        
    // Check if not a tts callback sended by RunStop plugin; If it is, process it with standard speak function
    var patt=new RegExp("^([0-9]{3}:[0-9]{2}:[0-9]{2})$");
    var res=patt.exec(str);   
    if (res!=null && res.length==2 && res[1]!="")
        return str;
    
    // If multiple sentence choice, then choose one
    str=selectSentence(str);
    
    // If in repeat mode then don't save what SARAH repeat
    if (g_repeat==0 && g_config.EnableRepeat=="1")
    {
        g_lastSpeakContent.pop();
        g_lastSpeakContent.unshift(str);
    }
    bf.debug(1, "ExtendedSpeak(\""+str+"\","+async+",SARAH)");
    // Check if ping is active on mobiles
    for (var i in g_ping)
    {
        bf.debug(2, "g_ping["+i+"]="+g_ping[i]);
        if (g_ping[i]<phoneinactivitydelay)
            nobody=false;
    }
    bf.debug(2, "nobody="+nobody+" (before)");
    // If no mobiles detected then be sure than the last motion detection was before the inactivity delay
    if (nobody==true && g_startInactivityDate.getTime()>0 && d.getTime()<g_startInactivityDate.getTime())
        // Check that we are not in ignore event period
        if (g_startIgnoreEventDate.getTime()==0 || d.getTime()>g_startIgnoreEventDate.getTime())
            nobody=false;
    bf.debug(2, "nobody="+nobody+" (after)");
    bf.debug(2, "InactivityDate="+g_startInactivityDate);
    bf.debug(2, "NotifyMode="+g_notify);
    // Need to send a notification ?
    if (nobody==true || g_config.EnableForceNotify=="1" || (g_notify>0 && g_config.EnableInstantNotification=="1") || isInTimeRange(d, g_NotifyTimeRange)==true)
    {
        // Yes, so adapt string to http transfer (transform space in '+')
        var fstr=str.replace(/ /,"+");
        // Replace [name] section by last identified profile
        fstr=fstr.replace("[name]", g_profile);
        // Choose notification plugin
        switch (g_config.NotificationPluginName)
        {
            case "push":
                var profile=g_config.PushPluginDefaultUser;
                if (g_config.PushUseProfilId=="1" && g_profile!="")
                    profile=g_profile;
                url=gs_push_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?silent=1&who="+profile+"&msg="+fstr;
                break;
            case "pushingbox":
               url=gs_pushingbox_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?tts="+fstr+"&quiet=1";
               break;
            case "pushover":
                url=gs_pushover_url.replace("<SERVER>", g_config.SarahServerIp.trim())+"?push="+fstr;
                break;
            default:
                console.log("ExtSpeak: Unknow notification system, please review plugin settings");
                break;
        }
        // If something to send, then send it now
        if (url!="")
        {
            var request = require('request');
            request(    { 'uri' : url }, 
                        function (err, response, body)
                        {
                        });
        }
    }
    // If one shot notify mode then clear it
    if (g_notify==1)
        g_notify=0;
    // If:
    //      someone is here, or no notification system setted, 
    //    AND
    //      force speak enabled, or in speak time range
    if ((nobody==false || url=="") && (g_config.EnableForceSpeak=="1" || isInTimeRange(d, g_SpeakTimeRange)==true))
        // Vocalize string
        return str;
    // Then no vocalisation 
    return false;
}

exports.speak=ExtendedSpeak;

var myStandBy = function(motion, data, SARAH)
{
    data.silent="1";
    data.mode="";
    // If in event ignore period, don't do anything
    if (g_startIgnoreEventDate.getTime()!=0 && d.getTime()<g_startIgnoreEventDate.getTime())
        return ;
    switch(motion)
    {
        case true:
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

exports.init = function(SARAH)
{
	var config=SARAH.ConfigManager.getConfig();
	var patt=new RegExp("([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})");
    var res;
    
	config=config.modules.ExtSpeak;
    g_config=config;
    console.log(g_config.SpeakTimeRange);
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
    // Set default parameters
    g_startInactivityDate.setTime(0);
    g_startIgnoreEventDate.setTime(0);
    // Kinect motion detect enabled ?
    if (g_config.EnableKinectMotionDetect=="1")
        exports.standBy=myStandBy;
    // Overload default settings by settings's one
    if (g_config.PingDelay!="")
        gs_pingDelay=parseInt(g_config.PingDelay);
    if (g_config.LeaveDelay!="")
        gs_ignoreEventDelay=parseInt(g_config.LeaveDelay);
    // Create array for mobiles list ping
    var arr=g_config.PhoneIpList.split(",");
    for (var i in arr)
    {
        g_ping.push(0);
        setTimer(i, arr[i].trim()); 
    }    
    // Only do that for testing
    if ((g_debug&4)!=0)
        setInterval(function()
                    {
                        SARAH.speak("Ceci est un test");
                    },
                    30*1000);
}

// Function to monitor mobiles pings
function setTimer(index, ping_addr)
{
    return setInterval(function()
                        {
                            var d=new Date();
                            
                            // Ignore event period ?
                            if (g_startIgnoreEventDate.getTime()!=0 && d.getTime()<g_startIgnoreEventDate.getTime())
                                // Yes so skip ping test
                                return ;
                            // Do ping
                            var exec = require('child_process').exec;
                            var ping = "ping -n 1 " + ping_addr;
                            var child = exec(ping, function(err, stdout, stderr) 
                                                    {
                                                        // Ping is KO ?
                                                        
                                                        if (stdout.search("Impossible")==-1)
                                                            // No, so save it
                                                            g_ping[index]=0;
                                                        else
                                                            // Yes, so save new failed ping
                                                            g_ping[index]+=1;
                                                    });
                        },
                        gs_pingDelay*1000);
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
            if (g_lastSpeakContent[i]!="")
            {
                count++;
                SARAH.speak(g_lastSpeakContent[i]);
            }
        }
        if (count==0 && mode>0)
            SARAH.speak(loc.getLocalString("IDCANTREMEMBER"));
    }
    g_repeat=0;
}

exports.release = function(SARAH)
{
   loc.release();
}

var action = function(data, callback, config, SARAH)
{
	var config=config.modules.ExtSpeak;
    var comment="";
    var d=new Date();
    var phoneinactivitydelay=(60/gs_pingDelay)*g_config.MinInactivityDelay;
    
    bf.debug(1, JSON.stringify(data));
    if (typeof(data.profile)!="undefined" && data.profile!="")
        g_profile=data.profile;
    switch (data.mode)
    {
        case "notify":
            // instant notify mode
            if (g_config.EnableInstantNotification=="1")
            {
                SARAH.speak(loc.getLocalString("OKLETSGO"));
                setTimeout(function(){g_notify=1;}, 2*1000);
            }
            else
                SARAH.speak(loc.getLocalString("IDNOINSTANTNOTIFY"));                
            break;
        case "notify_b":
            // instant notify period begin 
            if (g_config.EnableInstantNotification=="1")
            {
                SARAH.speak(loc.getLocalString("OKLETSGO"));
                setTimeout(function(){g_notify=2;}, 2*1000);
            }
            else
                SARAH.speak(loc.getLocalString("IDNOINSTANTNOTIFY"));                
            break;
        case "notify_e":
            // instant notify period end
            if (g_config.EnableInstantNotification=="1")
            {
                g_notify=0;
                SARAH.speak(loc.getLocalString("OKLETSGO"));
            }
            else
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
            break;
        case "activitynow":      
            g_startInactivityDate.setTime(0);
            for(var i in g_ping)
                g_ping[i]=0;
            comment=loc.getLocalString("OKLETSGO");
            break;
        case "idlenow":
            SARAH.speak(loc.getLocalString("OKLETSGO"));
           setTimeout(function()
                      {
                        g_startIgnoreEventDate.setTime(d.getTime()+(gs_ignoreEventDelay*1000));
                        for(var i in g_ping)
                            g_ping[i]=phoneinactivitydelay;
                        g_startInactivityDate.setTime(d.getTime()+g_config.MinInactivityDelay*60*1000);
                      }, 2*1000);
            break;
        case "detectactivity":
            g_startInactivityDate.setTime(0);
            if (g_startIgnoreEventDate.getTime()!=0 && d.getTime()<g_startIgnoreEventDate.getTime())
                break;
            for(var i in g_ping)
                g_ping[i]=0;
            break;
        case "detectidle":
            if (g_startInactivityDate.getTime()==0)
                g_startInactivityDate.setTime(d.getTime()+g_config.MinInactivityDelay*60*1000);
            if (g_startInactivityDate.getTime()==0 || d.getTime()>=g_startInactivityDate.getTime())
                for(var i in g_ping)
                    g_ping[i]=phoneinactivitydelay;
           break;
    }
    if (data.silent=="1")
        comment="";
	callback({'tts': comment});
	return 0;
}

exports.action=action;
