var request = require('request');
const aws = require('aws-sdk');
const sts = new aws.STS({ apiVersion: '2011-06-15' });
const awss = require('aws4');
const https = require('https');

const logLevels = { error: 4, warn: 3, info: 2, verbose: 1, debug: 0 };

// get the current log level from the current environment if set, else set to INFO
const currLogLevel = process.env.LOG_LEVEL != null ? process.env.LOG_LEVEL : 'debug';

// print the log statement, only if the requested log level is greater than the current log level
function log(logLevel, statement) {
    if (logLevels[logLevel] >= logLevels[currLogLevel]) {
        console.log(statement);
    }
}

aws.config.update({
    region: "eu-west-1"
});
const docClient = new aws.DynamoDB({ apiVersion: '2012-08-10' });

exports.handler = (event, context, callback) => {
    var userId = event.user_id;
    //var userId = 'f990ec30-19f0-11e8-80cc-efc14beec333';
    var res = {};

    function getAggregateResponse() {
        var queryArray = [];
        var userIdList = ['24342ac0-2e9a-11e8-89c3-0d287ba0bb72', 'f990ec30-19f0-11e8-80cc-efc14beec333'];
        var matchObject = {
            "$match":{
                "statement.actor.account.name": {
                "$in": userIdList
            }
            }
        };
        queryArray.push(matchObject);
        console.log('query'+JSON.stringify(queryArray));
        var propertiesObject = { pipeline: JSON.stringify(queryArray) };
        const aggregateRequestOptions = {
            uri: 'https://lrs-uat.oup.com/API/statements/aggregate',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ZmFjNzc2ZDYyYmJjNGUwZDg5NmEwNmNhNmY2ZmQ5ZGNmZWQ0YjA5MTpiM2JhMGIzMzA4YjRjNDQ1ZDg1Y2NlYmE1N2VjMTUzMTMxMTY4MmY3',
                'X-Experience-API-Version': '1.0.3'
            },
            qs: propertiesObject

        };
        request(aggregateRequestOptions, function(err, response, body) {
            if (err) { console.log(err); return; }

            console.log("Get response: " + response.statusCode);
            //console.log(JSON.parse(body));
            var aggResponse = JSON.parse(body);
            //res["aggregate"] = aggResponse;
            var extIds = [];
            var dyanmoKeyJson = [];
            for (var i = 0; i < aggResponse.length; i++) {
                var id = aggResponse[i].statement.object.id.split("/")[4];
                if(!(id in extIds)){
                    extIds[id] = id;
                    dyanmoKeyJson.push({ EXTERNAL_ID: { S: id} });
                }
                
            }
            console.log(extIds);
            console.log(JSON.stringify(res));
           getDynamoDbResponse(dyanmoKeyJson);
        });
    }

    function getDynamoDbResponse(keyJson) {
        var table = 'GradeBookSample';
        var extId = ['OUPDIS03'];
        
        var requestitems = {};
        requestitems[table] = {
            Keys: keyJson,
            ProjectionExpression: 'USER_NAME, BOOK_NAME, CEFR_LEVEL,WORDS_READ,LAST_READ,READING_TIME,READ_PERCENT'
        };

        var params = { RequestItems: requestitems };
        docClient.batchGetItem(params, function(err, data) {
            if (err) {
                console.log(err);
                return;
            }
            else {
                console.log(data.Responses[table]);
                res["dyanmo data"] = data.Responses[table];
                console.log('final result' + JSON.stringify(res));
                callback(null, res);
            }
        });
        
        console.log(res);
    }
    getClassDetails();

    function getClassDetails() {
        const assumeRoleParams = {
            DurationSeconds: 900,
            ExternalId:'d025293f-23f9-4baa-ac1e-1a7a7f21ca91',
            RoleArn: 'arn:aws:iam::147351039156:role/ces-emailservice-external-account-access',
            RoleSessionName: 'GradeBookSample'
        };
        console.log('before assume');
        sts.assumeRole(assumeRoleParams, function(err, assumedRole) {
            if (err) callback(`Cannot assume role in CES account, check to see if role still exists: ${err}`);
            else {
                var reqBody = '{ "userId":' + userId + ' }';
                const requestOptions = {
                    hostname: 's2go28zal8.execute-api.eu-west-1.amazonaws.com',
                    path: '/prod/api/ces/getClassDetails/org/88ffe8b0-30fa-11e8-9a91-0bd1349e2aea/class/ae88ac70-30fa-11e8-9a91-0bd1349e2aea',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    region: 'eu-west-1',
                    service: 'execute-api'
                };
                /*console.log("check :"+assumedRole.Credentials.AccessKeyId);
                console.log("check SecretAccessKey:"+assumedRole.Credentials.SecretAccessKey);*/

                var signature = awss.sign(requestOptions, {
                    accessKeyId: assumedRole.Credentials.AccessKeyId,
                    secretAccessKey: assumedRole.Credentials.SecretAccessKey,
                    sessionToken: assumedRole.Credentials.SessionToken
                });

                console.log('sign' + JSON.stringify(signature));



                const request = https.request(signature, function(response) {
                    console.log('entered request');
                    //console.log(response.data);
                    var responseString = '';

                    response.pipe(process.stdout);
                    response.on('data', function(data) {
                        responseString += data;
                    });
                    console.log(response.body);
                    response.on('end', function() {
                        console.log('request end');
                        callback(null, responseString);
                        console.log(responseString);
                    });
                });
                //request.write(item);
                /*console.log('here out of request');
                console.log(this.httpResponse);
            console.log(this.request.httpRequest);*/

                request.on('error', function(error) {
                    console.log('request error : ');
                    callback(error);
                });

                request.end();
            }
        });
    }

}
