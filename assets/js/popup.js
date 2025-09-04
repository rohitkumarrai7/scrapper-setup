//Sets of available environment
var ENV_URL = {
    // ENV: 'cse',
    // ENV: 'ss',
    // ENV: 'titans',
    // ENV: 'ts',
    // ENV: 'dev',
    ENV: 'prod',
    // ENV: 'neo',
    // ENV: 'local',
    // ENV: 'canada'
}

var api = 'https://api.mixpanel.com';
var analytics = {};
var mixpanel = {};
var isResumeManuallyUploaded = false;
var isLinkedinResumeUploaded = false;
var needToParseWEHistory = false;
var isCandidateExists = false;
var isOverRideAllowed = false;
var appointmentAttendees = null;
var enableNylasV3 = false;

analytics.init = function init(userObj) {

    // Env Split for Mixpanel
    var mixpanelKey;
    if (BASE_APP_URL == 'https://app.recruitcrm.io') {
        mixpanelKey = 'f1612220af14b0ad667fa48cf3ef6e06';
    } else {
        mixpanelKey = '6a66c6df50972e3aabab7d1b859c239d';
    }

    mixpanel.token = mixpanelKey;
    mixpanel.distinct_id = userObj.id;
    mixpanel.user_id = userObj.id;
    mixpanel.account_id = userObj.accountid;
    enableNylasV3 = userObj.enable_nylas_v3;
}

analytics.track = function track(event, eventObject) {
    var payload = {
        event: event,
        properties: {
            distinct_id: mixpanel.distinct_id,
            "$user_id": mixpanel.user_id,
            token: mixpanel.token,
            "ENV": BASE_APP_URL,
            "account_id": mixpanel.account_id
        }
    };

    Object.keys(eventObject)
        .forEach(function eachKey(key) {
            payload.properties[key] = eventObject[key];
        });

    var data = window.btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    var url = api + '/track?data=' + data;
    // console.log(data);
    $.get(url);
}

function mixpanelTrackEvent(event, eventObject) {
    analytics.track(event, eventObject)
}

var BASE_APP_URL, BASE_API_URL, BASE_URL_HIRING_PIPELINE, BASE_URL_NYMA;

switch (ENV_URL.ENV) {
    case 'cse':
        BASE_API_URL = "https://albatross-cse.recruitcrm.net/v1";
        BASE_APP_URL = "https://cse.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://cse-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://csenyma.recruitcrm.net/v2";
        break
    case 'ss':
        BASE_API_URL = "https://albatross-ss.recruitcrm.net/v1";
        BASE_APP_URL = "https://ss.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://ss-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://ssnyma.recruitcrm.net/v2";
        break
    case 'titans':
        BASE_API_URL = "https://albatross-titans.recruitcrm.net/v1";
        BASE_APP_URL = "https://titans.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://titans-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://titansnyma.recruitcrm.net/v2";
        break
    case 'ts':
        BASE_API_URL = "https://albatross-ts.recruitcrm.net/v1";
        BASE_APP_URL = "https://ts.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://ts-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://tsnyma.recruitcrm.net/v2";
        break
    case 'dev':
        BASE_API_URL = "https://albatross-dev.recruitcrm.net/v1";
        BASE_APP_URL = "https://dev.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://dev-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://devnyma.recruitcrm.net/v2";
        break;
    case 'prod':
        BASE_API_URL = "https://albatross.recruitcrm.io/v1";
        BASE_APP_URL = "https://app.recruitcrm.io";
        BASE_URL_HIRING_PIPELINE = "https://hiring-pipeline.recruitcrm.io/v1";
        BASE_URL_NYMA = "https://nyma.recruitcrm.io/v2";
        break;
    case 'canada':
        BASE_API_URL = "https://albatross-canada.recruitcrm.io/v1";
        BASE_APP_URL = "https://canada.recruitcrm.io";
        BASE_URL_HIRING_PIPELINE = "https://canada-hiring-pipeline.recruitcrm.io/v1";
        BASE_URL_NYMA = "https://canadanyma.recruitcrm.io/v2";
        break;
    case 'neo':
        BASE_API_URL = "https://albatross-neo-mr.recruitcrm.net/v1";
        BASE_APP_URL = "https://neo-mr.recruitcrm.net";
        BASE_URL_HIRING_PIPELINE = "https://neo-mr-hiring-pipeline.recruitcrm.net/v1";
        BASE_URL_NYMA = "https://neo-mrnyma.recruitcrm.net/v2";
        break;
    case 'local':
        BASE_API_URL = "http://localhost:9999/v1";
        BASE_APP_URL = "http://localhost";
        BASE_APP_URL = "http://localhost:8081";
        BASE_URL_HIRING_PIPELINE = "http://localhost:8282/v1";
        BASE_URL_NYMA = "http://localhost:8083/v2";
        break;
    default:
        BASE_API_URL = "https://albatross.recruitcrm.io/v1";
        BASE_APP_URL = "https://app.recruitcrm.io";
        BASE_URL_HIRING_PIPELINE = "https://hiring-pipeline.recruitcrm.io/v1";
        BASE_URL_NYMA = "https://nyma.recruitcrm.io/v2";
        break
}

var EXTENSION_ID = "pabamgafdnanldcgdhpfohfdpjjbekom"; //New Production
// var EXTENSION_ID = "aencnjhhpfdojledpfelnjjibkgmanjg"; //Canada Production
// var EXTENSION_ID = 'hbebajjmcjhkfcnemgiehekglikbcpnh' // Vivek local 

var extensionVersion = '3.1.89';
var BASE_URL = 'chrome-extension://' + EXTENSION_ID + '/';
var BASE_IMAGES_URL = BASE_URL + 'assets/images';
var BASE_CSS_URL = BASE_URL + 'assets/css';
var BASE_HTML_URL = BASE_URL + 'views/';
url = window.location.href;
var jobs = {};
var jobsFinal = [];
var candidateData = {};

var BASE_JS_URL = BASE_APP_URL + '/assets/js/sourcing_extension';
var select2Helper = {};
iconMap = { "person": "mdi-account", "business": "mdi-office-building", "assignment_ind": "mdi-clipboard-account", "account_circle": "mdi-account-circle", "business_center": "mdi-briefcase" };

// db_log = document;
function sendHttpRequest(type, url, data, formData = false, callBack = function (error) { }, fallBack = function (error) { }, skipExtVersion = false) {
    var xhttp = new XMLHttpRequest();
    xhttp.onload = function () {
        callBack(this.response);
    }
    xhttp.onerror = function () {
        fallBack(this.error)
    }
    xhttp.open(type, url);
    xhttp.withCredentials = true;
    if (!skipExtVersion) {
        data.extension_version = extensionVersion;
    }

    if (formData) {
        xhttp.send(data);
    }
    else {
        xhttp.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        // xhttp.setRequestHeader("Access-Control-Allow-Origin", "*");
        xhttp.send(JSON.stringify(data));
    }
}
function getRecordForSlug(key, selectkey, searchKey) {
    for (var element in select2Helper[selectkey][searchKey]) {
        var _element = select2Helper[selectkey][searchKey][element];
        if (_element.slug == key) {
            return _element;
        }
    };
};
function select2HelperFunction(message, type) {
    var relatedto = message.data.payload[type].relatedto;
    if (relatedto) {
        let slug = relatedto.substr(0, relatedto.lastIndexOf('_'));;
        var relatedtoObj = getRecordForSlug(slug, type + '_relatedto', 'selectedData');
        if (relatedtoObj) {
            message.data.payload[type].relatedtoname = relatedtoObj.title;
            message.data.payload[type].relatedtotypeid = relatedtoObj.entitytype;
            message.data.payload[type].relatedto = slug;
        } else {
            message.data.payload[type].relatedto = "";
        }
    }
    if (message.data.payload.extraData.collaboratorUserIds) {
        message.data.payload.collaborator_user_ids = message.data.payload.extraData.collaboratorUserIds;
    }
    if (message.data.payload.extraData.collaboratorTeamIds) {
        message.data.payload.collaborator_team_ids = message.data.payload.extraData.collaboratorTeamIds;
    }

    var collaborators = [];
    if (message.data.payload.extraData.collaborators.length) {
        message.data.payload.extraData.collaborators.forEach(key => {
            let slug = key.substr(0, key.lastIndexOf('_'));
            var collaborator = getRecordForSlug(slug, type + (type == "task" ? '_collaborators' : '_attendees'), 'selectedData');
            if (collaborator) {
                var _collaborator = {};
                _collaborator.attendeeid = collaborator.slug;
                _collaborator.attendeetype = collaborator.entitytype;
                _collaborator.email = collaborator.email
                _collaborator.icon = collaborator.icon;
                _collaborator.name = collaborator.title;
                collaborators.push(_collaborator);
            }
        });
    }
    message.data.payload.collaborator = collaborators;
    if (type != "task") {
        message.data.payload.task = false;
    }

    var ownerid = message.data.payload[type].ownerid;
    if (ownerid) {
        let slug = ownerid.substr(0, ownerid.lastIndexOf('_'));
        var owneridObj = getRecordForSlug(slug, type + '_ownerid', 'selectedData');
        if (owneridObj) {
            message.data.payload[type].ownerid = owneridObj.id;
        } else {
            message.data.payload[type].ownerid = null;
        }
    }
    message.data.payload.extraData = null;
    return message.data.payload;
}
function getCookie(cname) {
    try {
        var name = cname + "=";
        var encodedCookie = encodeURIComponent(document.cookie);
        var decodedCookie = decodeURIComponent(encodedCookie);
        var ca = decodedCookie.split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) == ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length, c.length).replace(/^"+|"+$/g, '');
            }
        }
        return "";
    } catch (error) {
        console.error('Error decoding cookie:', error);
    }
}
window.addEventListener('message', function (message) {

    if (message.data.message == 'create_request') {
        sendHttpRequest(message.data.method, message.data.url, message.data.data, false, function (response) {
            var _response = { "message": message.data.callback, "response": response, "global": true }
            sendMessageToIframe(_response);
        });
    }

    switch (message.data.message) {
        case "setExtenstion":
            setExtenstion();
            break;
        case "getUser":
            jobs = {};
            sendMessageToIframe("gettingUser");
            sendHttpRequest('POST', BASE_API_URL + "/extensions/chrome/getAuthUser", { getNotifications: true }, false, function (response) {
                var _response = { "message": "getUserFinished", "response": response, "appBaseURL": BASE_APP_URL }
                sendMessageToIframe(_response);
                var userData = JSON.parse(response)
                analytics.init(userData.user);
            });
            break;
        case "getLinkedInPersonProfile":
            if (message.data.slug) {
                fullProfileUrl = 'https://www.linkedin.com/voyager/api/identity/dash/profiles'
                let resources = ['profileView', 'profileContactInfo', `skills`];
                numResponses = 0;
                let fullProfile = {};
                resources.forEach(resource => {
                    var csrf = getCookie('JSESSIONID');
                    if (resource == "skills") {
                        var url = `https://www.linkedin.com/voyager/api/identity/profiles/${message.data.slug}/skills?count=100`
                    } else {
                        var url = `https://www.linkedin.com/voyager/api/identity/profiles/${message.data.slug}/${resource}`;
                    }
                    const options = {
                        method: "get",
                        headers: new Headers({
                            'content-type': 'application/json;charset=UTF-8',
                            'csrf-token': csrf
                        }),
                    };
                    fetch(url, options).then(function (response) {
                        if (response.ok) {
                            return response.json();
                        }
                        return Promise.reject(response);
                    }).then(function (data) {
                        fullProfile[resource] = data;
                    }).catch(function (error) {
                        console.log(error);
                    }).finally(function () {
                        numResponses++;
                        if (numResponses >= resources.length) {
                            var _response = {
                                "message": "getLinkedInPersonProfileFinished",
                                "response": fullProfile
                            }
                            sendMessageToIframe(_response);
                        }
                    });
                });
            }
            break;
        case "getLinkedInPersonProfilePdf":
            if (message.data.slug) {
                var tooManyReq = false
                let pdfLink = {};
                var csrf = getCookie('JSESSIONID');
                var url = `https://www.linkedin.com/voyager/api/identity/profiles/${message.data.slug}/profileActions?versionTag=${message.data.versionTag}&action=saveToPdf`;
                const options = {
                    method: "POST",
                    headers: new Headers({
                        'content-type': 'application/json;charset=UTF-8',
                        'csrf-token': csrf
                    }),
                };
                var base64String = "";

                async function getBase64String(data) {
                    var reader = new FileReader();
                    await new Promise((resolve, reject) => {
                        reader.onload = resolve;
                        reader.onerror = reject;
                        reader.readAsDataURL(data);
                    });
                    return reader.result.replace(/^data:.+;base64,/, '')
                }

                fetch(url, options).then(function (response) {
                    if (response.ok) {
                        return response.json();
                    }
                    return Promise.reject(response);
                }).then(async function (data) {
                    if (data.value) {
                        let response = await fetch(data.value);
                        if (response.ok) {
                            var body = await response.blob();
                            base64String = await getBase64String(body);
                        }
                    }
                }).catch(function (error) {
                    console.log(error);
                    if (error.code == "429") {
                        tooManyReq = true
                    }
                }).finally(function () {
                    var _response = {
                        "message": "getLinkedInPersonProfilePdfFinished",
                        "response": { 'base64profile': base64String, "tooManyReq": tooManyReq }
                    }
                    sendMessageToIframe(_response);
                });
            }
            break;
        case "getLinkedInCompanyProfile":
            if (message.data.slug) {
                let resources = ['company'];
                numResponses = 0;
                let fullProfile = {};
                resources.forEach(resource => {
                    var csrf = getCookie('JSESSIONID');
                    var url = `https://www.linkedin.com/voyager/api/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-28&q=universalName&universalName=${message.data.slug}`;
                    const options = {
                        method: "get",
                        headers: new Headers({
                            'content-type': 'application/json;charset=UTF-8',
                            'csrf-token': csrf
                        }),
                    };
                    fetch(url, options).then(function (response) {
                        if (response.ok) {
                            return response.json();
                        }
                        return Promise.reject(response);
                    }).then(function (data) {
                        fullProfile[resource] = data;
                    }).catch(function (error) {
                        console.log(error);
                    }).finally(function () {
                        numResponses++;
                        if (numResponses >= resources.length) {
                            var _response = {
                                "message": "getLinkedInCompanyProfileFinished",
                                "response": fullProfile
                            }
                            sendMessageToIframe(_response);
                        }
                    });
                });
            }
            break;
        case "candidateSubmit":
            formData = new FormData();
            //Appending override data to form
            formData.append('overrideData', message.data.payload.overrideData);
            isOverRideAllowed = message.data.payload.overrideData;
            Object.keys(message.data.payload.candidate).forEach(key => {
                if (key == 'resume') {
                    isResumeManuallyUploaded = true;
                }
                    
                formData.append(key, message.data.payload.candidate[key]);
            });
            if (Object.keys(message.data.payload.extraData).length) {
                var extraData = message.data.payload.extraData;
                if (extraData.note != undefined && extraData.note.trim() != '') {
                    formData.append('note', message.data.payload.extraData.note.trim());
                }
                if (extraData.collaboratorUserIds) {
                    formData.append('collaborator_user_ids', JSON.stringify(message.data.payload.extraData.collaboratorUserIds));
                }
                if (extraData.collaboratorTeamIds) {
                    formData.append('collaborator_team_ids', JSON.stringify(message.data.payload.extraData.collaboratorTeamIds));
                }
                if(extraData.noteTypeId) {
                    formData.append('note_type_id', message.data.payload.extraData.noteTypeId);
                }
                if (extraData.base64Profile != undefined && extraData.base64Profile.trim() != '') {
                    formData.append('base64Profile', message.data.payload.extraData.base64Profile.trim());
                    isLinkedinResumeUploaded = true;
                }
            }

            let education = [];
            let experience = [];
            let fileTypeCustomFields = [];
            let fieldsVisibleOnExtension = {};
            let fieldsVisibleOnExtensionList = [];
            let company = {};
            let companyRecord = [];
            if (message.data.payload.educationhistory != undefined){
                Object.keys(message.data.payload.educationhistory).forEach(key => {
                    education.push(message.data.payload.educationhistory[key]);
                });
                formData.append('educationhistory', JSON.stringify(education));
            }
            if (message.data.payload.workhistory != undefined) {
                Object.keys(message.data.payload.workhistory).forEach(key => {
                    experience.push(message.data.payload.workhistory[key]);
                });
                formData.append('workhistory', JSON.stringify(experience));
            }

            if (message.data.payload.fieldsVisibleOnExtension != undefined) {
                Object.keys(message.data.payload.fieldsVisibleOnExtension).forEach(key => {
                    fieldsVisibleOnExtension[key] = message.data.payload.fieldsVisibleOnExtension[key];
                });
                fieldsVisibleOnExtensionList.push(fieldsVisibleOnExtension);
                formData.append('fieldsVisibleOnExtension', JSON.stringify(fieldsVisibleOnExtensionList));
            }
            if (message.data.payload.fileTypeCustomFields != undefined) {
                for (let i = 0; i < message.data.payload.fileTypeCustomFields.length; i++) {
                    let fileCustomFieldKey = message.data.payload.fileTypeCustomFields[i];
                    let fileUploaded = message.data.payload.fieldsVisibleOnExtension[fileCustomFieldKey];
                    formData.append(fileCustomFieldKey, fileUploaded);
                }
                formData.append('fileTypeCustomFields', JSON.stringify(message.data.payload.fileTypeCustomFields));
            }
            if (message.data.payload.company != undefined){
                Object.keys(message.data.payload.company).forEach(key => {
                    company[key] = message.data.payload.company[key];
                });
                companyRecord.push(company);
                formData.append('companyRecord', JSON.stringify(companyRecord));
            }


            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/candidate", formData, true, function (response) {
                var _response = { "message": "submitCandidateFinished", "response": response }
                if (JSON.parse(response)) {
                    candidateData = JSON.parse(response)?.data?.candidate?.id;
                }

                if (JSON.parse(_response.response).data.duplicate_updated == true) {
                    isCandidateExists = true;
                }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "updateOrderingData":
            formData = new FormData();
            let payloadData = JSON.stringify(message.data.payload);
            
            formData.append('userSpecificOrdering', payloadData);

            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/update-section-order", formData, true, function (response) {
                var _response = { "message": "submitOrderingFinished", "response": response };
                sendMessageToIframe(_response);
                // reloadExtension();
            }, function (error) {
                console.log('error');
            });
            break;

        case "inlineEditEmail": 
            formData = new FormData();

            Object.keys(message.data.payload).forEach(key => {
                formData.append(key, message.data.payload[key]);
            });

            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/update-fields", formData, true, function (response) {
                var _response = { "message": "submitInlineEditEmail", "response": response };
                sendMessageToIframe(_response);
                // reloadExtension();
            }, function (error) {
                console.log('error');
            });

            break;

        
        case "inlineEditPhone": 
            formData = new FormData();

            Object.keys(message.data.payload).forEach(key => {
                formData.append(key, message.data.payload[key]);
            });

            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/update-fields", formData, true, function (response) {
                var _response = { "message": "submitInlineEditPhone", "response": response };
                sendMessageToIframe(_response);
                // reloadExtension();
            }, function (error) {
                console.log('error');
            });

            break;


        case "addDefaultNote":
            formData = new FormData();

            // we need to append all the key value pairs to the form data
            Object.keys(message.data.payload.noteAPIPayload).forEach(key => {
                if (key == "associated_data" || key == "collaborator_team_ids" || key == "collaborator_user_ids" || key == "userInNote") {
                    formData.append(key, JSON.stringify(message.data.payload.noteAPIPayload[key]));
                }
                else {
                    formData.append(key, message.data.payload.noteAPIPayload[key]);
                }
            });

            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/notes", formData, true, function (response) {
                var _response = { "message": "submitAddDefaultNote", "response": response };
                sendMessageToIframe(_response);
                // reloadExtension();
            }, function (error) {
                console.log('error');
            });

            break;
        case "contactSubmit":
            formData = new FormData();
            //Appending override data to form
            formData.append('overrideData', message.data.payload.overrideData);
            Object.keys(message.data.payload.contact).forEach(key => {
                formData.append(key, message.data.payload.contact[key]);
            });
            if (message.data.payload.extraData.note != undefined && message.data.payload.extraData.note.trim() != '') {
                formData.append('note', message.data.payload.extraData.note.trim());
            }
            if (message.data.payload.extraData.collaboratorUserIds) {
                formData.append('collaborator_user_ids', JSON.stringify(message.data.payload.extraData.collaboratorUserIds));
            }
            if (message.data.payload.extraData.collaboratorTeamIds) {
                formData.append('collaborator_team_ids', JSON.stringify(message.data.payload.extraData.collaboratorTeamIds));
            }
            if(message.data.payload.extraData.noteTypeId) {
                formData.append('note_type_id', message.data.payload.extraData.noteTypeId);
            }
            if (message.data.payload.company != undefined){
                formData.append('companyRecord', JSON.stringify(message.data.payload.company));
            }

            let fieldsVisibleOnExtensionForContact = {};
            let fieldsVisibleOnExtensionForContactList = [];
            let fileKeysForContact = [];

            if (message.data.payload.fieldsVisibleOnExtensionForContact != undefined) {
                Object.keys(message.data.payload.fieldsVisibleOnExtensionForContact).forEach(key => {
                    fieldsVisibleOnExtensionForContact[key] = message.data.payload.fieldsVisibleOnExtensionForContact[key];
                });
                fieldsVisibleOnExtensionForContactList.push(fieldsVisibleOnExtensionForContact);
                formData.append('fieldsVisibleOnExtensionForContact', JSON.stringify(fieldsVisibleOnExtensionForContactList));
            }
            if (message.data.payload.fileTypeCustomFieldsForContact != undefined) {
                message.data.payload.fileTypeCustomFieldsForContact.forEach(function (fileKey) {
                    formData.append(fileKey, fieldsVisibleOnExtensionForContact[fileKey]);
                })
                formData.append('fileTypeCustomFieldsForContact', JSON.stringify(message.data.payload.fileTypeCustomFieldsForContact));
            }

            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/contact", formData, true, function (response) {
                var _response = { "message": "submitContactFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "companyContactSubmit":
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/company", message.data.payload, false, function (response) {
                var _response = { "message": "submitCompanyContactFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "appointmentSubmit":
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/meetings", select2HelperFunction(message, 'appointment'), false, function (response) {
                var _response = { "message": "submitAppointmentFinished", "response": response }
                sendMessageToIframe(_response);
                message.source.document.getElementById('appointment_title').value = '';
                message.source.document.getElementById('appointment_description').value = '';
            }, function (error) {
                console.log('error');
            });
            break;
        case "taskSubmit":
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/tasks", select2HelperFunction(message, 'task'), false, function (response) {
                var _response = { "message": "submitTaskFinished", "response": response }
                sendMessageToIframe(_response);
                message.source.document.getElementById('task_title').value = '';
                message.source.document.getElementById('task_description').value = '';
            }, function (error) {
                console.log('error');
            });
            break;
        case "updateHiringStage":
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/update-hiring-stage", message.data.payload, false, function (response) {
                var _response = { "message": "updateHiringStageCheckForEmailTrigger", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            }, true);
            break;
        case "updateHiringStageEmailTrigger":
            let hiringStageTriggerURL = `${BASE_URL_NYMA}/extensions/chrome/${enableNylasV3 ? "nylas-v3/" : ""}internal-email-trigger`;
            sendHttpRequest("POST", hiringStageTriggerURL, message.data.payload, false, function (response) {
                var _response = { "message": "updateHiringStageFinished", "response": message.data.originalResponse }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            }, true);
            break;
        case "assignCandidateToJob":
            var jobData = Object.keys(jobs).map(key => {
                return jobs[key];
            });
            var selectedJobs = message.data.payload?.selectedJobs;
            if (selectedJobs.length) {
                jobData.forEach(job => {
                    job.checked = false;
                    if (selectedJobs.indexOf(job.slug?.toString() + '_4') != -1) {
                        job.checked = true;
                    }
                });
                var jobsForResponse = jobData.filter((job) => {
                    if (selectedJobs.indexOf(job.slug?.toString() + '_4') != -1) {
                        return true;
                    }
                    return false;
                });
            }

            // Remove duplicate item
            jobsForResponse = [...Object.values([...new Map(Object.values(jobsForResponse).map((item) => [item.id.toString(), item])).values()])]

            var payload = { "jobs": jobsForResponse, "candidates": message.data.payload.candidates }
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/assign", payload, false, function (response) {
                var _response = { "message": "assignCandidateToJobCheckForEmailTrigger", "response": response, "jobs": jobsForResponse }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "assignCandidateToJobEmailTrigger":
            let candidateAssignTriggerURL = `${BASE_URL_NYMA}/extensions/chrome/${enableNylasV3 ? "nylas-v3/" : ""}internal-email-trigger`;
            sendHttpRequest("POST", candidateAssignTriggerURL, message.data.payload, false, function (response) {
                var _response = { "message": "assignCandidateToJobFinished", "response": message.data.originalResponse }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "addToHotList":
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/hotlists", message.data.payload, false, function (response) {
                var _response = { "message": "addToHotListFinished", "response": response, "entity": message.data?.entity, "shared": message.data?.payload?.shared }
                sendMessageToIframe(_response);
                message.source.document.getElementById('add_new_hotlist').value = '';
            }, function (error) {
                console.log('error');
            });
            break;
        case "setUpFollowupControls":
            var section = message.data.section ? message.data.section + " " : "";
            var reinit = message.data.reinit ? true : false;
            var rcrmFrameWindow = document.getElementById('rcrm-ext-iframe').contentWindow;
            var rcrmframe = function (selector) { return $(selector, $("#rcrm-ext-iframe").contents()); };
            select2Helper.setValues = function (relatedto, selectkey) {//Add selected values in selectedData(used when values from the selected object are required)
                if (select2Helper[selectkey].searchedData.length) {
                    for (let selectedSlugKey = 0; selectedSlugKey < relatedto.target.selectedOptions.length; selectedSlugKey++) {
                        var selectedSlug = relatedto.target.selectedOptions[selectedSlugKey].value;
                        var _selectedSlug = selectedSlug.substr(0, selectedSlug.lastIndexOf('_'));
                        var _selectedSlugObject = getRecordForSlug(_selectedSlug, selectkey, 'searchedData');
                        if (_selectedSlugObject != undefined && _selectedSlugObject.slug != undefined) {
                            select2Helper[selectkey].selectedData[selectedSlug] = _selectedSlugObject;
                        }
                        if(selectkey == "appointment_relatedto") {
                            var addedAttendees = appointmentAttendees.val();
                            if(
                                (_selectedSlugObject.entitytype == 2 || _selectedSlugObject.entitytype == 5)
                                && !addedAttendees.includes(selectedSlug)
                                && addedAttendees.length < 10
                            ) {
                                    select2Helper['appointment_attendees'].selectedData[selectedSlug] = _selectedSlugObject;
                                    var newOptionText = _selectedSlugObject.title;
                                    var newOptionValue = selectedSlug;
                                    var newOption = new Option(newOptionText, newOptionValue, true, true);
                                    if(appointmentAttendees) {
                                        appointmentAttendees.append(newOption).trigger('change');
                                    }
                            }
                            
                        }
                        
                    }
                }
            }
            select2Helper.setInitValues = function (selectkey, entityData, data_init = "self") {
                var selectedObj = {};
                if (data_init == "self") {
                    switch (Object.keys(entityData.presetEntity)[0]) {
                        // TODO: Check what all has to be added in each entity.
                        case "candidate":
                            var _selectedObj = entityData.presetEntity["candidate"];
                            selectedObj = _selectedObj;
                            selectedObj.title = _selectedObj.candidatename;
                            selectedObj.email = _selectedObj.emailid;
                            selectedObj.entitytype = "5";
                            selectedObj.icon = "person";
                            selectedObj.id = _selectedObj.id;
                            selectedObj.link = "/candidate/" + _selectedObj.slug;
                            selectedObj.location = _selectedObj.locality;
                            selectedObj.mlink = "/mcandidate/" + _selectedObj.slug;
                            selectedObj.phone = _selectedObj.contactnumber;
                            selectedObj.slug = _selectedObj.slug;
                            select2Helper[selectkey].selectedData[selectedObj.slug + '_5'] = selectedObj;
                            break;
                        case "contact":
                            var _selectedObj = entityData.presetEntity["contact"];
                            selectedObj = _selectedObj;
                            selectedObj.title = _selectedObj.name;
                            selectedObj.email = _selectedObj.email;
                            // selectedObj.companyname = _selectedObj.companyname; 
                            selectedObj.entitytype = "2";
                            selectedObj.icon = "assignment_ind";
                            selectedObj.id = _selectedObj.id;
                            selectedObj.link = "/contact/" + _selectedObj.slug;
                            selectedObj.location = _selectedObj.locality;
                            selectedObj.mlink = "/mcontact/" + _selectedObj.slug;
                            selectedObj.phone = _selectedObj.contactnumber;
                            selectedObj.companyname = _selectedObj.companyname;
                            selectedObj.slug = _selectedObj.slug;
                            select2Helper[selectkey].selectedData[selectedObj.slug + '_2'] = selectedObj;
                            break;
                        case "company":
                            var _selectedObj = entityData.presetEntity["company"];
                            selectedObj = _selectedObj;
                            selectedObj.title = _selectedObj.companyname;
                            selectedObj.entitytype = "3";
                            selectedObj.icon = "business";
                            selectedObj.id = _selectedObj.id;
                            selectedObj.link = "/company/" + _selectedObj.slug;
                            selectedObj.location = _selectedObj.address;
                            selectedObj.mlink = "/mcompany/" + _selectedObj.slug;
                            selectedObj.slug = _selectedObj.slug;
                            select2Helper[selectkey].selectedData[selectedObj.slug + '_2'] = selectedObj;
                            break;
                        default:
                            break;
                    }
                }
                else if (data_init == "owner") {
                    var _selectedObj = entityData.user;
                    _selectedObj = entityData.user;
                    selectedObj = _selectedObj;
                    selectedObj.title = _selectedObj.name;
                    // selectedObj.email = _selectedObj.email;
                    selectedObj.entitytype = "6";
                    selectedObj.icon = "account_circle";
                    selectedObj.id = _selectedObj.id;
                    // selectedObj.link = "/user/" + _selectedObj.slug;
                    // selectedObj.mlink = "/muser/" + _selectedObj.slug;
                    selectedObj.slug = _selectedObj.slug;
                }
                return selectedObj;
            }
            $(section + ".rcrm-select2", document.getElementById('rcrm-ext-iframe').contentWindow.document).each(function () {

                if($(this).attr('id') == 'appointment_attendees') {
                    appointmentAttendees = $(this);
                }

                var selectkey = $(this).attr('data-selectkey');
                if (selectkey) {
                    select2Helper[selectkey] = { searchedData: {}, selectedData: {} };
                }
                if (!$(this).hasClass("select2-hidden-accessible") || reinit) {
                    var selec2Options = {
                        "width": '100%',
                        "ajax": ($(this).attr('data-ajax') == "true") ? {
                            "contentType": "application/json",
                            "url": $(this).attr('data-url'),
                            "data": function (search) {
                                if (!search.term) { search.term = "" };
                                var prtialData = JSON.parse($(this).attr('data-ajaxdata'));
                                var _data = prtialData;
                                _data.search = search.term.replace(/\//g, "");
                                _data.extension_version = extensionVersion;
                                _data.jobData = jobs;
                                return JSON.stringify(_data);
                            },
                            "dataType": 'json',
                            xhrFields: {
                                withCredentials: true
                            },
                            "delay": 500,
                            "type": 'POST',
                            "processResults": function (data) {
                                data.data.forEach(job => {
                                    // console.log(job);
                                    if (job.entitytype === "4") {
                                        jobs = {
                                            ...jobs,
                                            [`${Object.keys(jobs).length++}`]: job
                                        };
                                    }
                                });

                                jobs = [...Object.values([...new Map(Object.values(jobs).map((item) => [item.id.toString(), item])).values()])]

                                var _response = { "message": "updateJobData", "response": jobs }
                                sendMessageToIframe(_response);

                                if (selectkey) {
                                    select2Helper[selectkey].searchedData = data.data;
                                }
                                var valueParam = $(this).attr('data-valueParam');
                                return {
                                    results: $.map(data.data, function (record, index) {
                                        var title = record.title.concat(record.companynameforjob ? ' (' + record.companynameforjob + ')' : '').concat(record.location ? ' - ' + record.location : '');
                                        var jid = record.id;
                                        return {
                                            text: title,
                                            id: !valueParam ? record.slug + "_" + record.entitytype : record[valueParam],
                                            result: record,
                                            jbid: jid,
                                        }
                                    })
                                }
                            }
                        } : null,
                        "allowClear": $(this).attr('multiple') ? false : true,
                        "placeholder": $(this).attr('data-placeholder'),
                        "dropdownParent": rcrmframe($(this).attr('data-parent')),
                        "closeOnSelect": $(this).attr('data-closeOnSelect') == "false" ? false : true,
                        minimumInputLength: $(this).attr("data-minimum-searchchars") ? $(this).attr("data-minimum-searchchars") : 1,
                    };
                    if ($(this).attr("data-formatSearchResult") != "false") {
                        selec2Options.escapeMarkup = function (markup) { return markup; };
                        selec2Options.templateResult = formatResult;
                    }
                    rcrmframe(this).select2(selec2Options).on('change', function (e) {
                        if (selectkey && $(this).attr('data-selectObject') != false) {//used for realted to and attenee id as the selected object is required.
                            select2Helper.setValues(e, selectkey);
                        }
                    });
                    function formatResult(result) {
                        var jobsarr = localStorage.getItem("jobs_assign_ids" + candidateData);
                        var isSame = jobsarr !== null && jobsarr !== '' && jobsarr.includes(result.jbid);
                        if (result.loading) {
                            return result.text;
                        }
                        var icon = result.result.icon ? '<i class="mdi ' + (isSame ? "mdi-checkbox-marked-circle" : iconMap[result.result.icon]) + '"></i>' : "";
                        var email = result.result.email ? '<div>' + result.result.email + '</div>' : "";
                        var company = result.result.companynameforjob ? ' (' + result.result.companynameforjob + ') - ' + result.result.location : "";
                        var markup = '<a class="dropdown-item ' + (isSame ? 'isAssigned' : '') + '" title="' + (isSame ? 'Candidate already assigned' : '') + '">' +
                            '<div class="media">' +
                            '<div class="media-left">' + icon +
                            '</div>' +
                            '<div class="media-content ' + (isSame ? 'isAssigned' : '') + '">' + result.result.title + company + email +
                            '</div>' +
                            '</div>' +
                            '</a>'
                        return markup;
                    }
                } else {
                    $(this).val([]).trigger('change');
                }

                if ($(this).is('#add_to_hot_list_select')) {
                    $(this).on('change', function () {
                        if (!$(this).val()) {
                            $(this.parentElement.parentElement.nextElementSibling).css('display', 'flex');
                            $(this.parentElement.parentElement.nextElementSibling.nextElementSibling).css('display', 'block');
                            return;
                        }

                        if ($(this).val().length > 0) {
                            $(this.parentElement.parentElement.nextElementSibling).css('display', 'none');
                            $(this.parentElement.parentElement.nextElementSibling.nextElementSibling).css('display', 'none');
                        } else {
                            $(this.parentElement.parentElement.nextElementSibling).css('display', 'flex');
                            $(this.parentElement.parentElement.nextElementSibling.nextElementSibling).css('display', 'block');
                        }
                    });
                }

                var data_init = $(this).attr('data-init');
                if (data_init) {
                    if(($(this).attr('id') == 'appointment_attendees' && Object.keys(message.data.presetEntity)[0] == 'company')) {
                        //do nothing
                    } else {
                        var initOption = select2Helper.setInitValues(selectkey, message.data, data_init);
                        var newOptionText = initOption.title;
                        var valueParam = $(this).attr('data-valueParam');
                        var newOptionValue = !valueParam ? initOption.slug + "_" + initOption.entitytype : initOption[valueParam];
                        var newOption = new Option(newOptionText, newOptionValue, true, true);
                        if($(this).attr('id') == 'appointment_attendees') {
                            $(this).find('option').filter(function() {
                                return $(this).val() == newOptionValue;
                            }).remove();
                        }
                        $(this).append(newOption).trigger('change');    
                    }
                    
                }
            });
            break;
        case "getCompanies":
            var search = message.data.q.replace(/\//g, "");
            data = { 'search': search, 'candidates': false, 'contacts': false, 'compnaies': message.data.q, 'jobs': false, 'users': false }
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/search-entity", data, false, function (response) {
                var _response = { "message": "getCompaniesFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getContacts":
            var search = message.data.search.replace(/\//g, "");
            data = { 'search': search, 'candidates': false, 'contacts': true, 'compnaies': false, 'jobs': false, 'users': false }
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/search-entity", data, false, function (response) {
                var _response = { "message": "getContactsFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getContactsLinked":
            var data = { 'companyid': message.data.companyid };
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/getContacts", data, false, function (response) {
                var _response = { "message": "getContactsLinkedFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getJobsToAssignCandidate":
            var search = message.data.q?.replace(/\//g, "");
            data = { 'search': search, 'candidates': false, 'contacts': false, 'compnaies': false, 'jobs': true, 'users': false }
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/search-entity", data, false, function (response) {
                var _response = { "message": "getJobsToAssignCandidateFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getJobsToAssignCandidateForEmailTrigger":
            data = {};
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/get-jobs-to-assign/get", data, false, function (response) {
                var _response = { "message": "getJobsToAssignCandidateForEmailTriggerFinished", "response": response }
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getHotlists":
            data = message.data.data;
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/hotlists/get", data, false, function (response) {
                var _response = { "message": "getHotlistsFinished", "response": response }
                _response.entity = message.data.entity;
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getHotlistsBeforeGetAssignedHotlists":
            data = message.data.data;
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/hotlists/get", data, false, function (response) {
                var _response = { "message": "getHotlistsBeforeGetAssignedHotlistsFinished", "response": response }
                _response.entity = message.data.entity;
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "checkDuplicate":
            data = message.data.payload;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/duplicate", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "checkDuplicateFinished", "response": response };
                    if (JSON.parse(response)) {
                        candidateData = JSON.parse(response)?.data?.candidate?.id;
                    }
                    sendMessageToIframe(_response);
                }

            }, function (error) {
                console.log('error');
            });
            break;
        case 'fetchCandidateFieldsData':
            data = {};
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/custom-fields/get?entitytypeid=5", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "fetchCandidateFieldsDataFinished", "response": response };
                    sendMessageToIframe(_response);
                }

            }, function (error) {
                console.log('error');
            });
            break;
        case 'getGenderData':
            data = {};
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/get-gender-types", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getGenderDataFinished", "response": response };
                    sendMessageToIframe(_response);
                }

            }, function (error) {
                console.log('error');
            });
            break;
        case 'getCurrencyType':
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/currencies", [], false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getCurrencyTypeFinished", "response": response };
                    sendMessageToIframe(_response);
                }

            }, function (error) {
                console.log('error');
            });
            break;
        case "getHiringStages":
            data = message.data.data;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/get-hiring-pipeline-stages/get", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getHiringStagesFinished", "response": response };
                    sendMessageToIframe(_response);
                }
            }, function (error) {
                console.log('error');
            });
            break;
        case "getCustomPipelineHiringStagesByJob":
            data = message.data.payload;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("GET", BASE_URL_HIRING_PIPELINE + "/extensions/chrome/pipelines/get-pipeline-by-job/" + data.job_id, [], false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getCustomPipelineHiringStagesFinished", "response": response };
                    sendMessageToIframe(_response);
                }
            }, function (error) {
                console.log('error get custom hiring pipeline');
            });
            break;
        case "getHiringStagesEmailTrigger":
            data = message.data.data;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/get-hiring-stage-workflow-email-triggers", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getHiringStagesEmailTriggerFinished", "response": response };
                    sendMessageToIframe(_response);
                }
            }, function (error) {
                console.log('error');
            });
            break;
        case "getAssignedJobs":
            data = message.data.data;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + `/extensions/chrome/${message.data.data.id}/jobs-assigned/get`, data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "getAssignedJobsFinished", "response": response };
                    sendMessageToIframe(_response);
                }
            }, function (error) {
                console.log('error');
            });
            break;
        case "geAssignedtHotlists":
            data = message.data.data;
            var currentUrl = JSON.parse(JSON.stringify(window.top.location));
            sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/related-hotlists", data, false, function (response) {
                if (currentUrl.href == JSON.parse(JSON.stringify(window.top.location)).href) {
                    var _response = { "message": "geAssignedtHotlistsFinished", "response": response };
                    _response.entity = message.data.entity;
                    sendMessageToIframe(_response);
                }
            }, function (error) {
                console.log('error');
            });
            break;
        case "linkContact":
            data = message.data.payload;
            if (data?.candidateSlug && data?.contactSlug) {
                var payload = {
                    "byslug": true, "entityTypeId": data?.entityTypeId, "relatedto": null,
                    "message": "Linked Successfully.", "slug": [data?.contactSlug], "value": data?.candidateSlug
                }
                sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/link-contact", payload, false, function (response) {
                    var _response = { "message": "linkingFinished" }
                    sendMessageToIframe(_response);
                    console.log('Linked');
                }, function (error) {
                    console.log('error');
                });
            }
            break;
        case "parseCandidateResume":
            data = message.data.payload;
            if (isCandidateExists == false || (isCandidateExists == true && isOverRideAllowed == true)) {
                if (isResumeManuallyUploaded == false && isLinkedinResumeUploaded == false) {
                    needToParseWEHistory = false
                }
                else if (isResumeManuallyUploaded == true) {
                    needToParseWEHistory = false
                } else {
                    needToParseWEHistory = true
                }
            }
            else {
                needToParseWEHistory = false
            }

            if (data?.resumefilename && data?.resumefilename) {
                var payload = {
                    "resumefilename": data?.resumefilename,
                    "resume": data?.resume,
                    "slug": data?.slug,
                    "id": data?.id,
                    "addWEFromParser": needToParseWEHistory
                }
                sendHttpRequest("POST", BASE_API_URL + "/extensions/chrome/extract-resume-text", payload, false, function (response) {
                    console.log('resume-parse-success');
                }, function (error) {
                    console.log('error');
                });
            }
            break;

        case "mixpanelEventHandler":
            dataObject = message.data.payload;
            // console.log(data);
            eventMessage = message.data.event;
            // console.log(eventMessage);
            mixpanelTrackEvent(eventMessage, dataObject);
            break;
        case "getUserWithTeam":
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/users-with-teams", [], false, function (response) {
                var _response = { "message": "getUserWithTeamsFinished", "response": response, "baseImageUrl": BASE_IMAGES_URL }
                sendMessageToIframe(_response);
            });
            break;
        case "addGMeet":
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/g-meet", [], false, function (response) {
                var _response = { "message": "addGMeetFinished", "response": response }
                sendMessageToIframe(_response);
                let data = JSON.parse(response);
                if (data.data && data.data.meeting_link) {
                    message.source.document.getElementById('appointment_address').value = data.data.meeting_link;
                    message.source.document.getElementById('join_g_meet').style.display = 'flex';
                    message.source.document.getElementById('add_g_meet').style.display = 'none';
                } else {
                    message.source.document.getElementById('connect_g_meet').style.display = 'flex';
                    message.source.document.getElementById('gmeet_expired').style.display = 'block';
                    message.source.document.getElementById('add_g_meet').style.display = 'none';
                }
            })
        case "joinGMeet":
            var appointmentAddress = message.source.document.getElementById('appointment_address');
            if (appointmentAddress) {
                var url = appointmentAddress.value;
                if (url) {
                    window.open(url, '_blank');
                }
            }
            break;
        case "addG-Meet":
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/g-meet", [], false, function (response) {
                var _response = { "message": "addG-MeetFinished", "response": response }
                sendMessageToIframe(_response);
                let data = JSON.parse(response);
                if (data.data && data.data.meeting_link) {
                    message.source.document.getElementById('appointment_address').value = data.data.meeting_link;
                    message.source.document.getElementById('join_gmeet').style.display = 'flex';
                    message.source.document.getElementById('choose-meeting-dropdown').style.display = 'none';
                } else {
                    message.source.document.getElementById('g_meet_expired').style.display = 'block';
                }
            })
            break;
        case "addTeamMeet":
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/teams", [], false, function (response) {
                var _response = { "message": "add_team_meetFinished", "response": response }
                sendMessageToIframe(_response);
                let data = JSON.parse(response);
                if (data.data && data.data.meeting_link) {
                    message.source.document.getElementById('appointment_address').value = data.data.meeting_link;
                    message.source.document.getElementById('join_team_meet').style.display = 'flex';
                    message.source.document.getElementById('choose-meeting-dropdown').style.display = 'none';
                }
            })
            break;
        case "addZoomMeet" :
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/zoom", [], false, function (response) {
                var _response = { "message": "add_zoom_meetFinished", "response": response }
                sendMessageToIframe(_response);
                let data = JSON.parse(response);
                if (data.data && data.data.meeting_link) {
                    message.source.document.getElementById('appointment_address').value = data.data.meeting_link;
                    message.source.document.getElementById('join_zoom_meet').style.display = 'flex';
                    message.source.document.getElementById('choose-meeting-dropdown').style.display = 'none';
                }
            })
            break;
        case "getNestedCustomFields" :
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/nested-custom-fields/get/" + message.data.payload.entityTypeId, [], false, function (response) {
                var _response = { "message": "getNestedCustomFieldsFinished", "response": response, "entityTypeId" : message.data.payload.entityTypeId }
                sendMessageToIframe(_response);
            })
            break;
        case "getDefaultOptions" :
            sendHttpRequest("GET", BASE_API_URL + "/extensions/chrome/custom-fields/get-default-options/" + message.data.payload.entityTypeId, [], false, function (response) {
                var _response = { "message": "getDefaultOptionsFinished", "response": response, "entityTypeId" : message.data.payload.entityTypeId }
                sendMessageToIframe(_response);
            })
            break;
        case "getAddress" :
            let addressPayload = message.data.payload;
            let searchTerm = addressPayload.fieldValue ?? '';
            sendHttpRequest("GET", BASE_API_URL + '/extensions/chrome/get-address?searchTerm=' + searchTerm, [], false, function (response) {
                var _response = { "message": "getAddressFinished", "response": response, 'payload' : message.data.payload }
                sendMessageToIframe(_response);
            })
            break;
        case "getEntityTypeRecords":
            var payload = message.data.payload;
            var searchPayload = {
                search: payload.searchValue,
                candidates: false,
                contacts: false,
                compnaies: false,
                jobs: false,
                users: false
            }; 
            var searchURL = "/extensions/chrome/search-entity";
            if (payload.entityFieldType == 'candidate') {
                searchPayload.candidates = true;
            } else if (payload.entityFieldType == 'contact') {
                searchPayload.contacts = true;
            } else if (payload.entityFieldType == 'company') {
                searchPayload.compnaies = true;
            } else if (payload.entityFieldType == 'job') {
                searchPayload.jobs = true;
            } else if (payload.entityFieldType == 'deals') {
                searchURL = "/extensions/chrome/deal-global-search";
                searchPayload.deals = true;
            } else if (payload.entityFieldType == 'user' || payload.entityFieldType == 'team') {
                var _response = { "message": "getEntityTypeRecordsFinished", "response": JSON.stringify({"status" : "success"}) , "entityPayload": payload}
                sendMessageToIframe(_response);
                return;
            }
            sendHttpRequest("POST", BASE_API_URL + searchURL, searchPayload, false, function (response) {
                var _response = { "message": "getEntityTypeRecordsFinished", "response": response, 'entityPayload': payload}
                sendMessageToIframe(_response);
            }, function (error) {
                console.log('error');
            });
            break;
        case "getExistingEntityTypeValues" :
            let existingEntityPayload = message.data.payload;
            sendHttpRequest("POST", BASE_API_URL + '/extensions/chrome/entity-custom-fields/get', existingEntityPayload, false, function (response) {
                var _response = { "message": "getExistingEntityTypeValuesFinished", "response": response, 'entityTypeId' :existingEntityPayload.entityTypeId }
                sendMessageToIframe(_response);
            })
            break;
    }
})
// To receieve messages from backgroundjs. The receiver has to be present when sending messages from background
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message == "injected?") {
        if (document.getElementsByClassName('rcrm-ext-container').length) {
            hideExtension();
        }
        sendResponse("");
    }
    return;
});
function monitorUrlChange() {
    setInterval(() => {
        if (window.location.href != url) {
            url = window.location.href;
            if (url.indexOf('/detail/contact-info/') < 0) {
                sendMessageToIframe({ 'message': 'urlchanged' });
                // sendMessageToIframe({ "message": "urlchanged", "location": JSON.stringify(window.top.location) }); required in  click to parse
            }
        }
    }, 500);
}
function sendMessageToIframe(message) {
    var iframeEl = document.getElementById("rcrm-ext-iframe");
    if (iframeEl !== null && iframeEl.contentWindow !== null) {
        iframeEl.contentWindow.postMessage(message, '*');
        return true;
    } else {
        return false;
    }
}
function sendMessageTobackgroundJs(message, callback) {
    chrome.runtime.sendMessage({ "message": message }, function (response) {
        callback(response);
    });
}
function replaceUrls(content) {
    return content.replace(/{{BASE_CSS_URL}}/g, BASE_CSS_URL)
        .replace(/{{BASE_IMAGES_URL}}/g, BASE_IMAGES_URL)
        .replace(/{{BASE_APP_URL}}/g, BASE_APP_URL)
        .replace(/{{BASE_API_URL}}/g, BASE_API_URL)
}
var initExtension = function (replaceContent = false, error = false, errorMessage = "") {
    var errorFrameParams = {
        method: 'GET',
        url: BASE_HTML_URL + "/error.html"
    };
    var ajaxFrameParams = {
        method: 'GET',
        url: BASE_HTML_URL + "/home.html"
    };
    var ajaxFrameContentParams = {
        method: 'GET',
        url: BASE_HTML_URL + "/realhome.html"
    };
    var frameParams = $.ajax(ajaxFrameParams);
    var errorParams = $.ajax(errorFrameParams);
    var frameContentParams = $.ajax(ajaxFrameContentParams);
    Promise.all([frameParams]).then(function (frameResponse) {
        if (document.getElementsByClassName('rcrm-ext-container').length <= 0 || replaceContent) {
            var iframElement = document.getElementById('rcrm-ext-iframe');
            if (iframElement !== null && iframElement !== undefined && replaceContent) {
                iframElement.parentNode.removeChild(iframElement);
            }
            insetIframInWindow(frameResponse, replaceContent);
            if (!error) {
                Promise.all([frameContentParams]).then(function (frameContentResponse) {
                    const iframe = document.getElementById('rcrm-ext-iframe');
                    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
                    iframeDocument.write(replaceUrls(frameContentResponse[0]));


                    const scriptElement = iframeDocument.createElement('script');
                    scriptElement.src = chrome.runtime.getURL('/assets/js/jquery.3.7.1.min.js');
                    iframeDocument.head.appendChild(scriptElement);

                    // Dynamically load the main_frame_2_18.js script into the iframe
                    setTimeout(() => {
                    const scriptElement = iframeDocument.createElement('script');
                    scriptElement.src = chrome.runtime.getURL('/assets/js/main_frame_2_18.js');
                    iframeDocument.head.appendChild(scriptElement);
                }, 2);
                    setTimeout(() => {
                        // Dynamically load the jquery-controls.min.js script into the iframe
                        const scriptElementControls = iframeDocument.createElement('script');
                        scriptElementControls.src = chrome.runtime.getURL('/assets/js/jquery-controls.min.js');
                        iframeDocument.head.appendChild(scriptElementControls);
                    }, 2);
                    // Post message to the iframe window
                    window.postMessage({
                        "message": "getNestedCustomFields",
                        "payload": { "entityTypeId" : 5 }});
                    window.postMessage({
                        "message": "getNestedCustomFields",
                        "payload": { "entityTypeId" : 2 }});
                    window.postMessage({
                        "message": "getNestedCustomFields",
                        "payload": { "entityTypeId" : 3 }});
                    // window.postMessage({ "message": "getUser" }, '*');
                });
            } else {
                Promise.all([errorParams]).then(function (errorParamsResponse) {
                    document.getElementById('rcrm-ext-iframe').contentDocument.write(replaceUrls(errorParamsResponse[0]).replace("{{errorMessage}}", errorMessage));
                });
            }
        } else {
            hideExtension();
        }
    }
    );
    return true;
};
function hideExtension() {
    if ($('.rcrm-ext-container').css('display') == 'none') {
        $('.rcrm-ext-container').css('display', 'block');
    }
    else {
        $('.rcrm-ext-container').css('display', 'none');
    }
}
function insetIframInWindow(response) {
    var rcrmDiv = document.createElement('div')
    rcrmDiv.setAttribute("class", "rcrm-ext-container");
    rcrmDiv.innerHTML = response;
    document.body.appendChild(rcrmDiv);
}
function setExtenstion() {
    sendMessageTobackgroundJs("init?", function (response) {
        initExtension(false, response.errorRunExtension, response.errorMessage);
    });
};

setTimeout(() => {
    setExtenstion();
}, 15);
monitorUrlChange();
