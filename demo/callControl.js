$(function() {

    /** @type {RingCentral.SDK} */
    var sdk = null;
    /** @type {Platform} */
    var platform = null;
    /** @type {WebPhone} */
    var webPhone = null;

    var logLevel = 0;
    var username = null;
    var extension = null;
    var sipInfo = null;
    var $app = $('#app');

    var $loginTemplate = $('#template-login');
    var $authFlowTemplate = $('#template-auth-flow');
    var $callTemplate = $('#template-call');
    var $incomingTemplate = $('#template-incoming');
    var $acceptedTemplate = $('#template-accepted');

    var remoteVideoElement =  document.getElementById('remoteVideo');
    var localVideoElement  = document.getElementById('localVideo');

    var recordingId ="";
    var recordingStatus =false;


    localStorage.setItem('webPhoneSessionID', '');
    localStorage.setItem('webPhonePartyID', '');


    /**
     * @param {jQuery|HTMLElement} $tpl
     * @return {jQuery|HTMLElement}
     */
    function cloneTemplate($tpl) {
        return $($tpl.html());
    }

    function login(server, appKey, appSecret, login, ext, password, ll) {

        sdk = new RingCentral.SDK({
            appKey: appKey,
            appSecret: appSecret,
            server: server
        });

        platform = sdk.platform();

        // TODO: Improve later to support international phone number country codes better
        if (login) {
            login = (login.match(/^[\+1]/)) ? login : '1' + login;
            login = login.replace(/\W/g, '')
        }

        platform
            .login({
                username: login,
                extension: ext || null,
                password: password
            })
            .then(function () {
                return postLogin(server, appKey, appSecret, login, ext, password, ll);
            }).catch(function (e) {
            console.error(e.stack || e);
        });
    }

    // Redirect function
    function show3LeggedLogin(server, appKey, appSecret, ll) {

        var $redirectUri = decodeURIComponent(window.location.href.split('login', 1) + 'callback.html');

        console.log('The redirect uri value :', $redirectUri);

        sdk = new RingCentral.SDK({
            appKey: appKey,
            appSecret: appSecret,
            server: server,
            redirectUri: $redirectUri
        });

        platform = sdk.platform();

        var loginUrl = platform.loginUrl();

        platform
            .loginWindow({url: loginUrl})                       // this method also allows to supply more options to control window position
            .then(platform.login.bind(platform))
            .then(function () {
                return postLogin(server, appKey, appSecret, '','','',ll);
            })
            .catch(function (e) {
                console.error(e.stack || e);
            });

    }

    function postLogin(server, appKey, appSecret, login, ext, password, ll) {

        logLevel = ll;
        username = login;

        localStorage.setItem('webPhoneServer', server || '');
        localStorage.setItem('webPhoneAppKey', appKey || '');
        localStorage.setItem('webPhoneAppSecret', appSecret || '');
        localStorage.setItem('webPhoneLogin', login || '');
        localStorage.setItem('webPhoneExtension', ext || '');
        localStorage.setItem('webPhonePassword', password || '');
        localStorage.setItem('webPhoneLogLevel', logLevel || 0);

        localStorage.setItem('webPhoneSessionID', '');
        localStorage.setItem('webPhonePartyID', '');

        return platform.get('/restapi/v1.0/account/~/extension/~')
            .then(function(res) {

                extension = res.json();

                console.log('Extension info', extension);

                return platform.post('/client-info/sip-provision', {
                    sipInfo: [{
                        transport: 'WSS'
                    }]
                });

            })
            .then(function(res) { return res.json(); })
            .then(register)
            .then(makeCallForm)
            .catch(function(e) {
                console.error('Error in main promise chain');
                console.error(e.stack || e);
            });
    }

    function register(data) {

        sipInfo = data.sipInfo[0] || data.sipInfo;

        webPhone = new RingCentral.WebPhone(data, {
            appKey: localStorage.getItem('webPhoneAppKey'),
            audioHelper: {
                enabled: true
            },
            logLevel: parseInt(logLevel, 10),
            appName: 'WebPhoneDemo',
            appVersion: '1.0.0',
            media: {
                remote: remoteVideoElement,
                local: localVideoElement
            }
        });

        webPhone.userAgent.audioHelper.loadAudio({
            incoming: '../audio/incoming.ogg',
            outgoing: '../audio/outgoing.ogg'
        });

        webPhone.userAgent.audioHelper.setVolume(.3);
        webPhone.userAgent.on('invite', onInvite);
        webPhone.userAgent.on('connecting', function() { console.log('UA connecting'); });
        webPhone.userAgent.on('connected', function() { console.log('UA Connected'); });
        webPhone.userAgent.on('disconnected', function() { console.log('UA Disconnected'); });
        webPhone.userAgent.on('registered', function() { console.log('UA Registered'); });
        webPhone.userAgent.on('unregistered', function() { console.log('UA Unregistered'); });
        webPhone.userAgent.on('registrationFailed', function() { console.log('UA RegistrationFailed', arguments); });
        webPhone.userAgent.on('message', function() { console.log('UA Message', arguments); });

        return webPhone;

    }

    function onInvite(session) {

        console.log('EVENT: Invite', session.request);
        console.log('To', session.request.to.displayName, session.request.to.friendlyName);
        console.log('From', session.request.from.displayName, session.request.from.friendlyName);

        var $modal = cloneTemplate($incomingTemplate).modal({backdrop: 'static'});

        $modal.find('.answer').on('click', function() {
            $modal.find('.before-answer').css('display', 'none');
            $modal.find('.answered').css('display', '');
            session.accept()
                .then(function() {
                    $modal.modal('hide');
                    onAccepted(session);
                })
                .catch(function(e) { console.error('Accept failed', e.stack || e); });
        });

        //uses webrtc sdk
        $modal.find('.decline').on('click', function() {
            session.reject();
        });

        //uses webrtc sdk
        $modal.find('.toVoicemail').on('click', function() {
            session.toVoicemail();
        });

        $modal.find('.forward-form').on('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();

            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    platform.post('/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/forward', {
                        "phoneNumber": $modal.find('input[name=forward]').val().trim()
                    });
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        $modal.find('.reply-form').on('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            session.replyWithMessage({ replyType: 0, replyText: $modal.find('input[name=reply]').val() })
                .then(function() {
                    console.log('Replied');
                    $modal.modal('hide');
                })
                .catch(function(e) { console.error('Reply failed', e.stack || e); });
        });

        session.on('rejected', function() {
            $modal.modal('hide');
        });

    }

    function onAccepted(session) {

        console.log('EVENT: Accepted', session.request);
        console.log('To', session.request.to.displayName, session.request.to.friendlyName);
        console.log('From', session.request.from.displayName, session.request.from.friendlyName);

        var $modal = cloneTemplate($acceptedTemplate).modal();

        var $info = $modal.find('.info').eq(0);
        var $dtmf = $modal.find('input[name=dtmf]').eq(0);
        var $transfer = $modal.find('input[name=transfer]').eq(0);
        var $flip = $modal.find('input[name=flip]').eq(0);

        var interval = setInterval(function() {

            var time = session.startTime ? (Math.round((Date.now() - session.startTime) / 1000) + 's') : 'Ringing';

            $info.text(
                'time: ' + time + '\n' +
                'startTime: ' + JSON.stringify(session.startTime, null, 2) + '\n'
            );

        }, 1000);

        function close() {
            clearInterval(interval);
            $modal.modal('hide');
        }

        $modal.find('.increase-volume').on('click', function() {
            session.ua.audioHelper.setVolume(
                (session.ua.audioHelper.volume != null ? session.ua.audioHelper.volume : .5) + .1
            );
        });

        $modal.find('.decrease-volume').on('click', function() {
            session.ua.audioHelper.setVolume(
                (session.ua.audioHelper.volume != null ? session.ua.audioHelper.volume : .5) - .1
            );
        });

        $modal.find('.mute').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    console.error(recordingId);
                    platform.send({method: 'PATCH', url: '/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId +'', body:'{\"muted\" : true}'
                    }).then(

                    );
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        $modal.find('.unmute').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    console.error(recordingId);
                    platform.send({method: 'PATCH', url: '/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId +'', body:'{\"muted\" : false}'
                    }).then(

                    );
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        $modal.find('.hold').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    platform.post('/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/hold', '');
                }).then(function() { console.log('Holding'); })
                .catch(function(e) { console.error('Holding failed', e.stack || e); });
        });

        $modal.find('.unhold').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    platform.post('/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/unhold', '');
                })
                .catch(function(e) { console.error('UnHolding failed', e.stack || e); });
        });


        $modal.find('.startRecord').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    platform.post('/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/recordings', '').then(
                        function(res){
                            recordingId =  res.json().id;
                            recordingStatus= res.json().active;
                        }
                    );
                })
                .then(function() { console.log('Recording Started'); }).catch(function(e) { console.error('Recording Start failed', e.stack || e); });

        });

        $modal.find('.stopRecord').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;
                    console.error(recordingId);
                    platform.send({method: 'PATCH', url: '/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/recordings/'+ recordingId +'', body:'{\"active\" : false}'
                    }).then(

                    );
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        //uses webrtc sdk
        $modal.find('.park').on('click', function() {
            session.park().then(function() { console.log('Parked'); }).catch(function(e) { console.error('Park failed', e.stack || e); });
        });

        $modal.find('.transfer-form').on('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    partyId = res.json().activeCalls[0].partyId;

                    platform.post('/restapi/v1.0/account/~/telephony/sessions/' + telSessionId + '/parties/' + partyId + '/transfer', {
                        "phoneNumber": $modal.find('input[name=transfer]').val().trim()
                    });
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        //uses webrtc sdk
        $modal.find('.transfer-form button.warm').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            session.hold().then(function() {

                var newSession = session.ua.invite($transfer.val().trim());

                newSession.once('accepted', function() {
                    session.warmTransfer(newSession)
                        .then(function() { console.log('Transferred'); })
                        .catch(function(e) { console.error('Transfer failed', e.stack || e); });
                });

            });

        });

        //uses webrtc sdk
        $modal.find('.flip-form').on('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            session.flip($flip.val().trim()).then(function() { console.log('Flipped'); }).catch(function(e) { console.error('Flip failed', e.stack || e); });
            $flip.val('');
        });

        //uses webrtc sdk
        $modal.find('.dtmf-form').on('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            session.dtmf($dtmf.val().trim());
            $dtmf.val('');
        });

        $modal.find('.hangup').on('click', function() {
            return platform.get('/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true')
                .then(function(res) {
                    telSessionId  =  res.json().activeCalls[0].telephonySessionId;
                    console.log(telSessionId);
                    platform.send({method: 'DELETE', url: '/restapi/v1.0/account/~/telephony/sessions/' + telSessionId})
                })
                .catch(function(e) {
                    console.error('Error in main promise chain');
                    console.error(e.stack || e);
                });
        });

        session.on('accepted', function() { console.log('Event: Accepted'); });
        session.on('progress', function() { console.log('Event: Progress'); });
        session.on('rejected', function() {
            console.log('Event: Rejected');
            close();
        });
        session.on('failed', function() {
            console.log('Event: Failed');
            close();
        });
        session.on('terminated', function() {
            console.log('Event: Terminated');
            close();
        });
        session.on('cancel', function() {
            console.log('Event: Cancel');
            close();
        });
        session.on('refer', function() {
            console.log('Event: Refer');
            close();
        });
        session.on('replaced', function(newSession) {
            console.log('Event: Replaced: old session', session, 'has been replaced with', newSession);
            close();
            onAccepted(newSession);
        });
        session.on('dtmf', function() { console.log('Event: DTMF'); });
        session.on('muted', function() { console.log('Event: Muted'); });
        session.on('unmuted', function() { console.log('Event: Unmuted'); });
        session.on('connecting', function() { console.log('Event: Connecting'); });
        session.on('bye', function() {
            console.log('Event: Bye');
            close();
        });
    }

    //uses webrtc sdk to make call
    function makeCall(number, homeCountryId) {

        homeCountryId = homeCountryId
                      || (extension && extension.regionalSettings && extension.regionalSettings.homeCountry && extension.regionalSettings.homeCountry.id)
                      || null;

        var session = webPhone.userAgent.invite(number, {
            fromNumber: username,
            homeCountryId: homeCountryId
        });

        onAccepted(session);

    }

    //uses webrtc sdk to make call
    function makeCallForm() {

        var $form = cloneTemplate($callTemplate);

        var $number = $form.find('input[name=number]').eq(0);
        var $homeCountry = $form.find('input[name=homeCountry]').eq(0);

        $number.val(localStorage.getItem('webPhoneLastNumber') || '');

        $form.on('submit', function(e) {

            e.preventDefault();
            e.stopPropagation();

            localStorage.setItem('webPhoneLastNumber', $number.val() || '');

            makeCall($number.val(), $homeCountry.val());

        });

        $app.empty().append($form);

    }

    function makeLoginForm() {

        var $form = cloneTemplate($loginTemplate);
        var $authForm = cloneTemplate($authFlowTemplate);

        var $server = $authForm.find('input[name=server]').eq(0);
        var $appKey = $authForm.find('input[name=appKey]').eq(0);
        var $appSecret = $authForm.find('input[name=appSecret]').eq(0);
        var $login = $form.find('input[name=login]').eq(0);
        var $ext = $form.find('input[name=extension]').eq(0);
        var $password = $form.find('input[name=password]').eq(0);
        var $logLevel = $authForm.find('select[name=logLevel]').eq(0);


        $server.val(localStorage.getItem('webPhoneServer') || RingCentral.SDK.server.sandbox);
        $appKey.val(localStorage.getItem('webPhoneAppKey') || '');
        $appSecret.val(localStorage.getItem('webPhoneAppSecret') || '');
        $login.val(localStorage.getItem('webPhoneLogin') || '');
        $ext.val(localStorage.getItem('webPhoneExtension') || '');
        $password.val(localStorage.getItem('webPhonePassword') || '');
        $logLevel.val(localStorage.getItem('webPhoneLogLevel') || logLevel);


        $form.on('submit', function(e) {

            console.log("Normal Flow");

            e.preventDefault();
            e.stopPropagation();

            login($server.val(), $appKey.val(), $appSecret.val(), $login.val(), $ext.val(), $password.val(), $logLevel.val());

        });
        //
        $authForm.on('submit', function(e) {

            console.log("Authorized Flow");

            e.preventDefault();
            e.stopPropagation();

            show3LeggedLogin($server.val(), $appKey.val(), $appSecret.val(), $logLevel.val());

        });

        $app.empty().append($authForm).append($form);

    }

    makeLoginForm();

});
