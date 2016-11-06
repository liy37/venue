'use strict';

import User from './user.model';
import passport from 'passport';
import config from '../../config/environment';
import jwt from 'jsonwebtoken';
import Section from "../section/section.model";
import * as email from '../../components/email';

var path = require('path');
var fs = require('fs');

function validationError(res, statusCode) {
  statusCode = statusCode || 422;
  return function(err) {
    return res.status(statusCode).json(err);
  }
}

function handleError(res, statusCode) {
  statusCode = statusCode || 500;
  return function(err) {
    return res.status(statusCode).send(err);
  };
}

function respondWith(res, statusCode) {
  statusCode = statusCode || 200;
  return function() {
    return res.status(statusCode).end();
  };
}

function createSignupVerificationToken(req, user, cb){
  user.setVerificationToken();
  var message = {
      email: user.email,
      name: user.firstName,
      verifyURL: req.protocol + "://" + req.get('host') + "/verify/" + user.verificationToken};
  cb(message);
}

function createForgotPasswordVerificationToken(req, user, cb){
  user.setVerificationToken();
  var message = {
      email: user.email,
      name: user.firstName,
      verifyURL: req.protocol + "://" + req.get('host') + "/verify/resetPassword/" + user.verificationToken};
  cb(message);
}

/**
 * Get list of users
 * restriction: 'admin'
 */
export function index(req, res) {
  return User.findAsync({})
    .then(users => {
      return res.status(200).json(users);
    })
    .catch(handleError(res));
}

/**
 * Creates a new user
 */
export function create(req, res, next) {
  var newUser = new User(req.body);
  newUser.provider = 'local';
  newUser.role = 'user';
  newUser.isVerified = false;
  newUser.preferences = {emailNotifyAheadMinutes : [30]};
  return newUser.saveAsync()
    .spread(function(user) {
      var token = jwt.sign({ _id: user._id }, config.secrets.session, {
        expiresIn: 60 * 60 * 5
      });
      createSignupVerificationToken(req, user, (message) => email.signup(message));
      return res.json({ token });
    })
    .catch(validationError(res));
}

export function getExampleCSVUpload(req, res, next){
  return res.sendFile(path.join(__dirname,"./example_csv_upload.csv"));
}

/**
 * Verifies a User's email address
 */
export function verify(req, res, next) {
  var token = req.params.token;
  return User.findOneAsync({ 'verificationToken' : token })
    .then((user) => {
      if(!user){return res.json({isVerified:false});}
      user.isVerified = true;
      user.verificationToken = undefined;
      return user.saveAsync()
        .then(() => {
          return res.json({isVerified:true});
        });
    })
}

/**
 * Resends a verificaiton link for a user to verify their email
 */
export function resendEmail(req, res, nest) {
  var emailAddress = req.body.email;
  if(emailAddress !== undefined){
    return User.findOne({ 'email' : emailAddress })
      .select('email firstName lastName isVerified')
      .execAsync()
      .then((user) => {
        if(!user){
          return handleError(res)({"message": "Email has not yet been registered. Sign up for an account."});
        }
        if(user.isVerified){
          return handleError(res)({"message": "User has already been verified"});
        }
        createForgotPasswordVerificationToken(req, user)
        return res.json({success:true});
      })
  }
  else{
    return handleError(res)({"message": "No email entered"});
  }
}

/**
 * Sends an email with a link to set the account's password
 */
export function resetPasswordEmail(req, res, nest) {
  var emailAddress = req.body.email;
  if(emailAddress !== undefined){
    return User.findOne({ 'email' : emailAddress })
      .select('email firstName lastName isVerified')
      .execAsync()
      .then((user) => {
        if(!user){
          return handleError(res)({"message": "Email has not yet been registered. Sign up for an account."});
        }
        if(!user.isVerified){
          return handleError(res)({"message": "User has not yet been verified"});
        }
        createForgotPasswordVerificationToken(req, user, (message) => email.forgotPassword(message));
        return res.json({success:true});
      })
  }
  else{
    return handleError(res)({"message": "No email entered"});
  }
}

/**
 * Creates users in database from a CSV file
 */
export function createFromCSVUpload(req, res, next){
  var csvFile = req.files.files[0];
  // Parse CSV File
  var fileLines = fs.readFileSync(csvFile.path).toString().split("\n");
  for (var a = 0; a < fileLines.length; a++){
    fileLines[a] = fileLines[a].split(",");
  }

  // Make sure header is correct
  var header = fileLines[0];
  var firstNameIndex = -1;
  var lastNameIndex = -1;
  var emailIndex = -1;
  var passwordIndex = -1;
  var isInstructorIndex = -1;
  for (var i = 0;i < header.length;i++){
    header[i] = header[i].toLowerCase().trim();
    if (header[i] === "first name"){
      firstNameIndex = i;
    }else if (header[i] === "last name"){
      lastNameIndex = i;
    }else if (header[i] === "email"){
      emailIndex = i;
    }else if (header[i] === "password"){
      passwordIndex = i;
    }else if (header[i] === "is instructor"){
      isInstructorIndex = i;
    }
  }
  if (firstNameIndex === -1){
    return res.status(500).send({"message": "Missing \"First Name\" in header."});
  }else if (lastNameIndex === -1){
    return res.status(500).send({"message": "Missing \"Last Name\" in header."});
  }else if (emailIndex === -1){
    return res.status(500).send({"message": "Missing \"Email\" in header."});
  }else if (passwordIndex === -1){
    return res.status(500).send({"message": "Missing \"Password\" in header."});
  }else if (isInstructorIndex === -1){
    return res.status(500).send({"message": "Missing \"Is Instructor\" in header."});
  }

  // Add each user to the server
  return Promise.all(fileLines.slice(1).map((line) => {
    return new Promise((resolve, reject) => {
      var firstName = line[firstNameIndex];
      var lastName = line[lastNameIndex];
      var email = line[emailIndex];
      var password = line[passwordIndex];

      if (firstName === "" || lastName === "" || email === "" || password === ""){
        resolve("");
        return;
      }

      var isInstructorLine = (line[isInstructorIndex] || "").toLowerCase().trim();
      var isInstructor = (
          isInstructorLine === "true" ||
          isInstructorLine === "yes" ||
          isInstructorLine === "x");

      var newUser = new User({
        firstName: firstName,
        lastName: lastName,
        email: email,
        password: password,
        isInstructor: isInstructor
      });
      newUser.provider = 'local';
      newUser.role = 'user';
      newUser.save().then(() => {
        resolve(`Successfully created user ${firstName} ${lastName}, ${email}`);
      }).catch(() => {
        resolve(`Error creating user ${firstName} ${lastName}, ${email}`);
      })
    });
  })).then(messages => {
    return res.json(messages);
  }).catch((err) => {
    console.log("An error occurred doing CSV upload", err);
    return handleError(err)
  });

}

// Takes a Bool flag and Function func, returns a Promise to execute func on
// mongooseObject and responseObject inputs
// call the "done" of func when finished manipulating data.
// @param Function func: func(mongooseObject, responseObject, done)
// Note: The function "func" must return [mongooseObject, responseObject]
function ifFlagManipulate(flag, func){
  return (mongooseObject, responseObject) => {
    if (flag){
      return new Promise((resolve, reject) => {
        func(mongooseObject, responseObject, (newMongooseObject, newResponseObject)=>{
          if (!newResponseObject){
            var err = newMongooseObject;
            return reject(err);
          }else{
            return resolve([newMongooseObject, newResponseObject]);
          }
        });
      });
    }else{
      return Promise.all([mongooseObject, responseObject]);
    }
  };
}

/**
 * Get a single user
 */
export function show(req, res, next) {
  var userId = req.params.id;
  return User.findById(userId)
  .execAsync()
  .then((user) => {
    if (!user) {
      return res.status(404).end();
    }
    var profile = user.toJSON();
    return Promise.all([user, profile]);
  })
  .spread(ifFlagManipulate(req.query.withSections, (user,profile,done)=>{
    return user.getSectionsAsync(req.query).then((sections) => {
      profile.sections = sections;
      return done(user, profile);
    });
  }))
  .spread(ifFlagManipulate(req.query.withEvents, (user,profile,done)=>{
    return user.getEventsAsync(req.query).then((events)=>{
      profile.events = events;
      return done(user, profile);
    });
  }))
  .spread(ifFlagManipulate(req.query.withSectionEvents, (user,profile,done)=>{
    return user.getSectionEventsAsync(req.query).then((sectionevents)=>{
      profile.sectionEvents = sectionevents.map(se => se.toObject());
      return done(user, profile);
    });
  }))

  .spread(ifFlagManipulate(req.query.withCourses, (user,profile,done)=>{
    return user.getCoursesAsync(req.query).then((courses)=>{
      profile.courses = courses;
      return done(user, profile);
    });
  }))
  .spread(ifFlagManipulate((req.query.withSectionEvents && req.query.withSubmissionFlag), (user,profile,done)=>{
    return user.getSubmissionsAsync(req.query).then((submissions)=>{
      submissions.forEach(submission => {
        profile.sectionEvents = profile.sectionEvents.map( se => {
          se.submitted = se.submitted || submission.sectionEvent === se._id;
          return se;
        });
      });
      return done(user, profile);
    });
  }))
  .spread((user,profile) => {
    return res.json(profile);
  })
  .catch(err => next(err));
}

/**
 * Deletes a user
 * restriction: 'admin'
 */
export function destroy(req, res) {
  return User.findById(req.params.id)
    .then((user)=>{
      if (req.params.realDestroy){
        return user.remove().then(() => {
          return res.status(200).end();
        }).catch(handleError(res));
      }else{
        user.lastName = "";
        user.firstName = "[deleted user]";
        user.password = "DELETED";
        return user.save().then(function(usr) {
          return res.status(200).end();
        }).catch(handleError(res));
      }
    }).catch(handleError(res));
}

/**
 * Change a users password
 */
export function changePassword(req, res, next) {
  var userId = req.user._id;
  var oldPass = String(req.body.oldPassword);
  var newPass = String(req.body.newPassword);

  return User.findById(userId)
    .select('_id email password provider salt')
    .execAsync()
    .then(user => {
      if (user.authenticate(oldPass)) {
        user.password = newPass;
        return user.saveAsync()
          .then(() => {
            return res.status(204).end();
          })
          .catch(validationError(res));
      } else {
        return res.status(403).end();
      }
    });
}

/**
 * Resets a user's password if they forgot it.
 * Uses email verificaiton via a token
 */
export function resetPassword(req, res, next) {
  var newPass = String(req.body.newPassword);
  var token = String(req.body.token);
  return User.findOne({ 'verificationToken' : token })
    .select('_id email password provider salt verificationToken')
    .execAsync()
    .then(user => {
      if (user !== null && user.verificationToken === token) {
        user.password = newPass;
        user.verificationToken = undefined;
        return user.saveAsync()
          .then(() => {
            return res.json({success:true});
          })
          .catch(validationError(res));
      } else {
        return handleError(res)({"message": "Invalid link"});
      }
    });
}


/**
 * Enroll in a section
 */
export function enrollInSection(req, res, next) {
  var userId = req.user._id;
  var sectionId = req.body.sectionid;
  return Section.findByIdAsync(sectionId)
    .then( section => {
      if (section.enrollmentPolicy === "approvalRequired"){
        if (section.pendingStudents.indexOf(userId) === -1){
          section.pendingStudents.push(userId);
        }
      }else{
        section.students.push(userId);
      }
      section.saveAsync()
      .then(()=> {
        return res.json(section);
      })
      .catch(handleError(res));
    })
    .catch(err => next(err));
}

/**
 * Unenroll in a section
 */
export function unenrollInSection(req, res, next) {
  var userId = req.user._id;
  var sectionId = req.body.sectionid;
  return Section.findOneAndUpdateAsync({"_id": sectionId} , {
      $pull : {students: userId}
    }).then( section => {
      return res.json(section);
    })
    .catch(err => next(err));
}

/**
 * Get my info
 */
export function me(req, res, next) {
  var userId = req.user._id;
  req.params.id = userId;
  return show(req, res, next);
}
/**
 * Get user's sections
 */
export function sections(req, res, next) {
  var userId = req.params.id;

  return User.findOneAsync({ _id: userId })
    .then(user => {
      if (!user) {
        return res.status(401).end();
      }
      return user.getSectionsAsync().then((sections)=>{
        return res.json(sections)
      })
      .catch(err => next(err));

    })
    .catch(err => next(err));
}

/**
 * Get user's events
 */
export function events(req, res, next) {
  var userId = req.params.id;

  return User.findOneAsync({ _id: userId })
    .then(user => {
      if (!user) {
        return res.status(401).end();
      }
      return user.getEventsAsync().then((events)=>{
        return res.json(events)
      })
      .catch(err => next(err));

    })
    .catch(err => next(err));
}

/**
 * Authentication callback
 */
export function authCallback(req, res, next) {
  return res.redirect('/');
}

export function promoteToInstructor(req, res, next) {
  return User.findOneAsync({ _id: req.body.userId })
    .then(user => {
      if (!user) {
        return res.status(401).end();
      }
      if(!user.isInstructor) {
        user.isInstructor = true;
        return user.saveAsync()
          .then(() => {
            return res.status(204).end();
          })
          .catch(handleError(res));
      }
      else {
        return res.status(403).end();
      }
    })
    .catch(err => next(err));
}
