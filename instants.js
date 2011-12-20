// Mon Instant de bonheur est une application créée en 1 heure dans le cadre d'un séminaire.
// Plus d'info sur https://github.com/jraigneau/instant


// Configuration de l'application
// ------------------------------

// Déclaration des dépendances
var express = require('express');       //le framework web express
var mongoose = require('mongoose');     //La librairie pour accéder à mongodb
var csrf = require('express-csrf');     //la protection anti csrf
var mailgun = require("mailgun");

// Création de l'application express
var app = module.exports = express.createServer();

// Déclaration d'un helper dynamique pour la protection [cross-site request forgery](http://fr.wikipedia.org/wiki/Cross-site_request_forgery)
app.dynamicHelpers({
    csrf: csrf.token
});

// Configuration de l'application, notamment des modules (ou middleware) express utilisés
// 
// Cette configuration est commune à l'environnement de développement et à l'environnement de production
app.configure(function(){
  app.set('views', __dirname + '/views');                       // Définition du répertoire contenant les vues
  app.set('view engine', 'jade');                               // Le moteur de template - Jade
  app.use(express.favicon());                                   // un favicon automatique (pour éviter des erreurs 404 systématiques dans les logs)
  app.use(express.bodyParser());                                // Pour gérer les formulaires
  app.use(express.cookieParser());                              // Pour la gestion des cookies et des sessions
  app.use(express.session({ secret: 'awfjepyionn14962wxcv' })); // clé d'encodage pour les cookies et les sessions
  app.use(express.methodOverride());                            // middleware pour la gestion des actions http (post/get/put/delete)
  app.use(app.router);                                          // Routage des urls
  app.use(express.static(__dirname + '/public'));               // le répertoire contenant les images, javascript et css
  app.use(csrf.check());                                        // le module anti-csrf
  // Utilisation de page 404 customisée (cf views/404.jade)
  app.use(function(req, res, next){
    res.render('404', { status: 404, url: req.url, title: "Erreur" });
  });
  // Utilisation de page 40x et 50x customisée (cf views/500.jade)
  app.use(function(err, req, res, next){
    res.render('500', {
      status: err.status || 500
    , error: err
    , title: "Erreur"
    });
  });

});

// Déclaration de la configuration spécifique à l'environnement de développement: 
// Ici on décide de faire apparaître clairement les erreurs avec les traces
// Récupération de la variable d'environnement mongodb_url, à paramétrer via **export mongodb_url=mongodb://<user>:<password>@<url>:<port>/<db>**
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  mongoose.connect(process.env.mongodb_url);
});


// Déclaratio de la configuration spécifique à l'environnement de production: 
// Pas de trace affichée en production
// Récupération de la variable d'environnement mongodb_url, spécifique à l'hébergement sous heroku
app.configure('production', function(){
  app.use(express.errorHandler());
  mongoose.connect(process.env.mongodb_url);

});

// Préparation de la gestion des données
// -------------------------------------

// Déclaration des modèles MongoDB
var Schema = mongoose.Schema
  , ObjectId = Schema.ObjectId;

// Le modèle des commentaires **Comments** qui sera inclus dans chaque bonheur (embedded document pour mongodb)
// Le champ **author** est un index
var Comments = new Schema({
    author    : { type: String, index:  true  }
  , body      : String
  , date      : Date
});

// Le modèle des questions **Question**, vous noterez la liste des réponses **answers** incluse
var Bonheurs = new Schema({
    author    : { type: String, index:  true  }
  , body      : String
  , date      : Date
  , nb_comments: Number // Nombre de commentaires -- utile pour les stats
  , comments   : [Comments]
  , votes : Number
});

// Déclaration des modèles pour utilisation dans le code
var Bonheur = mongoose.model('bonheurs', Bonheurs)
var Comment = mongoose.model('commentaires', Comments)


// Début de la déclaration des Routes
// ----------------------------------
// Il est important de noter que nous utilisons du javascript, par conséquent tout fonctionne via
// [callbacks](http://www.coursweb.ch/javascript/callbacks.html) et des conditions imbriquées.

// ###Page d'erreur 404
app.get('/404', function(req, res, next){
  next(); // Permet d'aller à l'action suivante (cf la configuration et les fonctions définies plus haut)
});

// ###Page d'erreur 500
app.get('/500', function(req, res, next){
  next(new Error('Holy guacamole!'));
});


// ###Index de MrPourquoi
app.get('/', function(req, res){
  Bonheur.find({},[],{skip:0,limit:3, sort:{date : -1} },function (err, doc){      //Utilisation de la fonction find avec une limite de 5 questions
    if(err != null) {
      console.log("Error in GET /" + err);
      req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste des instants de bonheur n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
      res.redirect('back');
    } else if(doc == null) {
      req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé d\'instant de bonheur en base - pourquoi ne pas en partager un ? ');
      res.redirect('back');
    } else {

      // Fonction de map qui renvoie la liste des réponses au question avec (id_question, answer_body, answer_date)
      mapFunction = function() {
        var question_id = this._id
        this.comments.forEach(function(answer) {
          emit(answer._id, {answer_body: answer.body,answer_date: answer.date, question_id: question_id});
        });
      }; 

      // Fontion de reduce qui fait la somme du nbre de réponses/votes à partir des données émises
      // par la fonction de map, puis retourne un array de résultat
      reduceFunction = function(key, values) { //reduce function
        var result = {answer_body: "", answer_date: 0, question_id: ""};
        values.forEach(function(value) {
          result.answer_body = value.answer_body;
          result.answer_date = value.answer_date;
          result.question_id = value.question_id;
        });
        return result;
      };
      // Préparation de la commande qui sera envoyée à mongodb et stockée dans **mr_questions_answers**
      //
      // Utilisation du mode replace pour remplacer les résultats à chaque nouvelle requète
      var command = {
        mapreduce: "bonheurs", 
        map: mapFunction.toString(), 
        reduce: reduceFunction.toString(),
        out: {replace:"mr_list_answers"}
      };
      // Execution de la commande **map_reduce_cmd** de map/reduce pour récupérer le nombre total de réponse
      mongoose.connection.db.executeDbCommand(command, function(err, doc) {if(err !=null) { console.log("Error in GET /" + err);}});
      
      // Récupération des résultats (commande spécifique à mongoose)
      mongoose.connection.db.collection('mr_list_answers', function(err, collection) { 
        if(err != null) {
          console.log("Error in GET /" + err);
          req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste d\'instants de bonheur n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
          res.redirect('back');
        } else {
          collection.find({},[],{skip:0,limit:3, sort:{_id : -1} }).toArray(function(err, mr_answers) { //tri par l'id: très laid mais pas trouvé encore d'autres solutions
            if(err != null) {
              console.log("Error in GET /" + err);
              req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste d\'instants de bonheur n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
              res.redirect('back');
            } else {
              res.render('index', {          // on utilise le template index.jade
              title: 'Accueil',            // Le titre (champ utilisé dans layout.jade)
              abuse: 'index',
              questions: doc,
              answers: mr_answers,
              locals: {flash: req.flash()}  // Pour s'assurer que les messages flash seront bien transmis
              });

              }
            });
          }
        });
    }
  });



});



// ###Gestion du vote pour une question
//
// En entrée nous avons l'**id** de la question
app.get('/bonheur/:id/vote', function(req, res){

  if(req.params.id == null || req.params.id == ''){           // Vérification que l'id est bien dans la requête, sinon un message d'erreur
    req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant :( ');
    res.redirect('back');
  } else {
  
    Bonheur.findById(req.params.id, function (err, doc){     // Recherche de la question correspondant à l'id en base
      if(err != null) {                                       // Une erreur est survenue pendant la recherche en base
        console.log("Error in GET /Bonheur/:id/vote" + err); 
        req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre instant de bonheur n\'a pas été trouvé dans la base. Pourquoi ne pas réessayer ?');
        res.redirect('back');
      } else if(doc == null) {                                // Aucune question ne correspond à l'id => envoi d'un message d'erreur
          req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant  :( ');
          res.redirect('back');
      } else {
        doc.votes = doc.votes + 1;                            // On ajoute un vote supplémentaire à la question
        doc.save(function (err) {                             // Sauvegarde de la question en base
          if(err == null) {                                   // Tout s'est bien passé: retour à la page précédente avec un message
            req.flash('success', 'Bravo! vous avez voté pour un instant de bonheur qui devient ainsi un peu plus populaire gràce à vous');
            res.redirect('back');
          } else {                                            // La sauvegarde a échoué - retour à la page précédente avec un message d'alerte
            console.log("Error in GET /Bonheur/:id/vote" + err);
            req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre vote n\'a pas été enregistré. Pourquoi ne pas réessayer ?');
            res.redirect('back');
          }
        });
      }
    });
  }
});

// ###Répondre à une question via un POST
//
// En entrée l'**id** de la question dans l'url et **req.body.answer.text** pour récupérer le texte
// de la réponse dans le formulaire

app.post('/bonheur/:id/commentaire', function(req, res){

  if(req.params.id == null || req.params.id == ''){         //Vérification qu'un id a bien été entré
    req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant de bonheur pour y apporter un commentaire :( ');
    res.redirect('back');
  } else {
  
    Bonheur.findById(req.params.id, function (err, doc){  //Recherche de la question en base via l'id
      if(err != null) {
        console.log("Error in GET /bonheur/:id/answer" + err);
        req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre instant de bonheur n\'a pas été trouvé dans la base. Pourquoi ne pas réessayer ?');
        res.redirect('back');
      } else if(doc == null) {
          req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant :( ');
          res.redirect('back');
      } else {                                             //La question existe - il est donc possible de répondre
         if(req.body.comment.text==null || req.body.comment.text=='' || req.body.comment.author=='' || req.body.comment.author==null ){//Vérification qu'un texte pour la réponse a bien été entré dans le formulaire
            req.flash('error', 'Holy guacamole! Pour commenter un bonheur, il faut d\'abord remplir les champs ci-dessous !');
            res.redirect('back');
          } else {
          //Création d'un objet **Comments** et initialisation
          var comment = new Comment();
          comment.author = req.body.comment.author;
          comment.date = new Date();
          comment.votes = 0;
          comment.body = req.body.comment.text;
          doc.nb_comments = doc.nb_comments + 1;
          doc.comments.push(comment); // On ajoute l'objet **Comment** dans la question via la méthode **push()**
          doc.save(function (err) { // Sauvegarde de la question
            if(err == null) {
              req.flash('success', 'Merci ! vous avez partagé un commentaire sur un instant de bonheur avec nous - pourquoi ne pas lire et commenter d\'autres instants de bonheur ?');
              res.redirect('back');
            } else {
              console.log("Error inGET /bonheur/:id/answer" + err);
              req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre commentaire n\'a pas été enregistré. Pourquoi ne pas réessayer ?');
              res.redirect('back');
            }
          });
        }
      }
    });
  }
});




// ###Récupération des données d'une question via son **id**
app.get('/bonheur/:id/show', function(req, res){

  if(req.params.id == null || req.params.id == ''){
    req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant de bonheur  :( ');
    res.redirect('back');
  } else {
  
    Bonheur.findById(req.params.id, function (err, doc){
      if(err != null) {
        console.log("Error in GET /bonheur/:id" + err);
        req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre instant de bonheur n\'a pas été trouvé dans la base. Pourquoi ne pas réessayer ?');
        res.redirect('back');
      } else if(doc == null) {
          req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé l\'instant de bonheur  :( ');
          res.redirect('back');
      } else {
          res.render('view_question', {             // Affichage de view_question.jade
            title: 'Un instant de bonheur et ses commentaires',
            abuse: req.params.id,
            question: doc,                          // l'objet Bonheur est envoyé dans le template pour utilisation des données
            locals: {flash: req.flash()}
          });
      }
    });
  }
});


// ###Affichage du formulaire pour créer une nouvelle question
app.get('/bonheur', function(req, res){
  res.render('question', {
    title: 'Partager un instant de bonheur',
    abuse: '',
    locals: {flash: req.flash()}
  });
});

// ###Création d'une nouvelle question en base
//
//En entrée on a un formulaire contenant le texte de la question, récupérable via
//**req.body.question.text**
app.post('/bonheur', function(req, res){

  //console.log("req.body:" + req.body.question.text); 
  if(req.body.bonheur.text==null || req.body.bonheur.text=='' || req.body.bonheur.author==null || req.body.bonheur.author =='' ){
    req.flash('error', 'Holy guacamole! Pour partager un bonheur, il faut d\'abord remplir tous les champs ci-dessous !');
    res.redirect('back');
  } else {
    //Création d'un objet **Bonheur** et initialisation avec les données
    var bonheur = new Bonheur();
    bonheur.author =  req.body.bonheur.author;
    bonheur.date = new Date();
    bonheur.votes = 0;
    bonheur.nb_comments = 0;
    bonheur.body = req.body.bonheur.text;
    bonheur.save(function (err) { //Insertion de l'objet en base
      if(err == null) {
        req.flash('success', 'Bien joué! Votre instant de bonheur a bien été partagé');
      } else {
        console.log("Error in POST /bonheur:" + err);
        req.flash('error', 'Bloody tzatziki! Une erreur est survenue et votre instant de bonheur n\'a pas été partagé. Pourquoi ne pas réessayer ?');
        res.redirect('back');
      }
    });
    res.redirect('/bonheur/'+bonheur._id+'/show');
  }
});

// ###Récupération de la liste de toutes les questions
//
// Utilisation de mapreduce pour calculer le nbre de réponses/votes totaux basé sur [kylebanker.com](http://kylebanker.com/blog/2009/12/mongodb-map-reduce-basics/) et sur 
// [wmilesn.com](http://wmilesn.com/2011/07/code/how-to-map-reduce-with-mongoose-mongodb-express-node-js/)
app.get('/bonheur/list', function(req, res){


  Bonheur.find(function (err, doc){      //Utilisation de la fonction find sans critère => nous récupérons donc tous les éléments en base
    if(err != null) {
      console.log("Error in GET /bonheur/list" + err);
      req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste des instants de bonheur n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
      res.redirect('back');
    } else if(doc == null) {
      req.flash('error', 'Holy guacamole! Nous sommes désolé mais nous n\'avons pas trouvé d\'instant en base - pourquoi ne pas en rédiger un ? ');
      res.redirect('back');
    } else {
      // Fonction de map qui renvoie le nbre de réponses et et le nombre de votes totaux par
      // question, en utilisant une clé **answer_vote** qui sera commune pour faire l'aggrégation
      // totale
      mapFunction = function() {
        emit("answer_vote", {answers: this.nb_comments, votes: this.votes});
      }; 

      // Fontion de reduce qui fait la somme du nbre de réponses/votes à partir des données émises
      // par la fonction de map, puis retourne un array de résultat
      reduceFunction = function(key, values) { //reduce function
        var result = {answers: 0, votes: 0};
        values.forEach(function(value) {
          result.answers += value.answers;
          result.votes += value.votes;
        });
        return result;
      };
      
      // Préparation de la commande qui sera envoyée à mongodb et stockée dans **mr_questions_answers**
      //
      // Utilisation du mode replace pour remplacer les résultats à chaque nouvelle requète
      var command = {
        mapreduce: "bonheurs", 
        map: mapFunction.toString(), 
        reduce: reduceFunction.toString(),
        out: {replace: "mr_questions_answers"}
      };
      // Execution de la commande **map_reduce_cmd** de map/reduce pour récupérer le nombre total de réponse
      mongoose.connection.db.executeDbCommand(command, function(err, doc) {});

      // Récupération des résultats (commande spécifique à mongoose)
      mongoose.connection.db.collection('mr_questions_answers', function(err, collection) { 
        if(err != null) {
          console.log("Error in GET /bonheur/list" + err);
          req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste de bonheurs n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
          res.redirect('back');
        } else {
          collection.find({}).toArray(function(err, mr_answers) {
            if(err != null) {
              console.log("Error in GET /bonheur/list" + err);
              req.flash('error', 'Bloody tzatziki! Une erreur est survenue et la liste de bonheurs n\'a pas été trouvée dans la base. Pourquoi ne pas réessayer ?');
              res.redirect('back');
            } else {
              var nb_comments = 0;
              var nb_votes = 0;
              // Vérification qu'on a bien récupéer quelque chose qui se trouve à la position 0 de
              // l'array
              if(mr_answers.length>0) {
                nb_comments = mr_answers[0].value.answers;
                nb_votes = mr_answers[0].value.votes;
              }

              res.render('list_questions', {  //On affiche le template list_questions.jade
                title: 'Les instants de bonheur',
                abuse: 'liste_page1',
                questions: doc,
                answers: nb_comments,
                votes: nb_votes,
                locals: {flash: req.flash()}
              });

              }
            });
          }
        });
      }
    });
});

app.get('/abuse/:id',function(req, res){
  var mg = new mailgun.Mailgun('key-5x1d5i9ewratpmanjzn-rls35oikdtx8');
  mg.sendText('abuse@instant-de-bonheur.fr',
         process.env.email,
         '[instant-de-bonheur] Abuse: un contenu a été signalé comme offensant',
         req.params.id,
         function(err) { err && console.log(err) });
  req.flash('success', 'Merci de nous avoir averti de ce contenu, nous allons le traiter dès que possible');
  res.redirect('back');
});

// ###Permet d'accéder aux pages de la documentation 
// (les pages que vous lisez normalement!!)
// On utilise la fonctionnalité sendfile pour envoyer des pages statiques
// A noter que pour se simplifier la vie, une route pour la feuille de style docco.css est prévue
app.get('/about', function(req, res){ 
  res.sendfile(__dirname + '/docs/instants.html')
}); 

app.get('/docco.css', function(req, res){ 
  res.sendfile(__dirname + '/docs/docco.css')
}); 


// ###Lancement de l'application
//
//A noter l'utilisation de la variable **process.env.PORT** qui est nécessaire pour le
//fonctionnement chez Heroku.com
var port = process.env.PORT || 3210;
app.listen(port, function(){
  console.log("Listening on " + port);
});
console.log("Express server listening on port %d", app.address().port);


