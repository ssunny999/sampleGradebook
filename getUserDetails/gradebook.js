'use strict';
var request = require('request');
const aws = require('aws-sdk');

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

function errorMsg(msg) {
    return {
        "Error": msg
    };
}

exports.handler = (event, context, callback) => {
    var userId = event.pathParameters.user_id;
    log("debug", "userId: " + userId);
    if (!userId) {
        log('error', 'User id is null');
        returnResponse(400,errorMsg('User id is invalid' + userId));
        return;
    }
    //var userId = 'f990ec30-19f0-11e8-80cc-efc14beec333';
    var res = {};
    console.log('event : ' + JSON.stringify(event));

    function getXApiResponse() {
        const requestOptions = {
            uri: 'https://lrs-uat.oup.com/data/xAPI/statements?statementId=716f694c-473a-4e85-8572-8085a1023d86&format=exact&attachments=false',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ZmFjNzc2ZDYyYmJjNGUwZDg5NmEwNmNhNmY2ZmQ5ZGNmZWQ0YjA5MTpiM2JhMGIzMzA4YjRjNDQ1ZDg1Y2NlYmE1N2VjMTUzMTMxMTY4MmY3',
                'X-Experience-API-Version': '1.0.3'
            },

        };

        request(requestOptions, function(err, response, body) {
            if (err) { console.log(err); return; }
            console.log("Get response: " + response.statusCode);
            //console.log(JSON.parse(body));
            res["xapi"] = JSON.parse(body);
            //console.log('final result' + res);
            console.log(JSON.stringify(res));
            //getAggregateResponse();
            getDynamoDbResponse();
        });
    }

    function getAggregateResponse() {

        var queryArray = [{ "$project": { "_id": 0, "statement": 1, "lrs_id": 1 } }, {
            "$match": {
                "statement.actor.account.name": userId
            }
        }];
        if (event.queryStringParameters) {
            var endPosition = event.queryStringParameters.endPosition;
            var startPosition = event.queryStringParameters.startPosition;
            console.log('endp' + endPosition);
            if (startPosition != null && !isNaN(startPosition) && endPosition != null && !isNaN(endPosition)) {
                var limitObject = { "$limit": parseInt(endPosition) };
                var skipObject = { "$skip": (startPosition - 1) };
                if (parseInt(endPosition) < parseInt(startPosition)) {
                    log('error', 'endPosition must be greater than startPosition');
                    returnResponse(400,errorMsg('endPosition must be greater than startPosition'));
                    return;
                }
                queryArray.push(limitObject);
                queryArray.push(skipObject);
            }
            else if (endPosition != null && !isNaN(endPosition)) {
                console.log("limit applied");
                queryArray.push({ "$limit": parseInt(endPosition) });
            }
        }
        console.log('queryArray' + JSON.stringify(queryArray));
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
            if (err) {
                console.log(err);
                returnResponse(500,errorMsg("Unexpected Error : " + err));
                return;
            }
            log('debug', 'body : ' + body);
            if (!body) {
                log('error', 'No records found');
                returnResponse(400,errorMsg('No statements found for ' + userId));
                return;
            }
            var aggResponse = JSON.parse(body);
            res["aggregate"] = aggResponse;
            var extIds = [];
            var dyanmoKeyJson = [];
            for (var i = 0; i < aggResponse.length; i++) {
                var id = aggResponse[i].statement.object.id.split("/")[4];
                if (!(id in extIds)) {
                    extIds[id] = id;
                    dyanmoKeyJson.push({ EXTERNAL_ID: { S: id } });
                }

            }
            console.log(extIds);
            //console.log(JSON.stringify(res));
            getDynamoDbResponse(dyanmoKeyJson);

        });
    }

    function getDynamoDbResponse(keyJson) {
        var table = 'GradeBookSample';
        keyJson = [{ EXTERNAL_ID: { S: 'OUPDIS03' } }];
        var requestitems = {};
        requestitems[table] = {
            Keys: keyJson,
            ProjectionExpression: 'USER_NAME, BOOK_NAME, CEFR_LEVEL,WORDS_READ,LAST_READ,READING_TIME,READ_PERCENT'
        };

        var params = { RequestItems: requestitems };
        docClient.batchGetItem(params, function(err, data) {
            if (err) {
                console.log(err);
                returnResponse(500,errorMsg("Unexpected Error : "+err));
                return;
            }
            else {
                console.log(data.Responses[table]);
                res["dyanmo data"] = data.Responses[table];
                console.log('final result' + JSON.stringify(res));
                returnResponse(200,res);
            }
        });

        console.log(res);
    }
    getUserAccount();
    //getDynamoDbResponse([]);

    function getUserAccount() {

        var reqBody = { "userId": userId };
        const requestOptions = {
            uri: 'https://rightsuite-elb.eit-primary.eit.access.the-infra.com/acesWebService/rest/V1.0/services/getUserAccount',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reqBody)

        };
        request(requestOptions, function(err, response, body) {
            if (err) {
                console.log(err);
                returnResponse(500,errorMsg("Unexpected Error : "+err));
                return;
            }
            if (response.statusCode != 200) {
                returnResponse(400,errorMsg('Error in getUserAccount api. Status Code:' + response.statusCode));
                log('error', 'Error in getUserAccount api. Status Code:' + response.statusCode);
                return;
            }
            console.log("Get response: " + response.statusCode);
            var apiResponse = JSON.parse(body);
            if(apiResponse.status == 'ERROR'){
                returnResponse(400,errorMsg('Could not fetch user details. Error:' + apiResponse.errorMessages));
                log('error', 'Could not fetch user details. Error:' + apiResponse.errorMessages);
                return;
            }
            res["User Details"] = JSON.parse(body).user;
            if(res)
            console.log(JSON.stringify(res));
            
            getAggregateResponse();
        });

    }

    function returnResponse(status,resp) {
        var responseApi = {
            "statusCode": status,
            "isBase64Encoded": false,
            "body": JSON.stringify(resp)

        };
        callback(null, responseApi);
    }

};
