const db = require('../database');
const Trip = db.models.Trip;
const User = db.models.Person;
const Location = db.models.Location;
const Participant = db.models.Participant;
const Car = db.models.Car;
const { parseParticipants } = require('./utils');

module.exports.deleteTrip = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;

  try {
    // get Trip instance associated to the provided id
    const trip = await Trip.findByPk(tripId);
    if (!trip) throw {
      status: 404,
      message: 'No trip found with provided id'
    };

    // delete trip
    await trip.destroy();

    // populate response object
    res.ok = true;
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
  } finally {
    // send response
    ctx.body = res;
  }
};

module.exports.removeUser = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;
  // store user_email passed as parameter
  const userId = ctx.params.user_email;

  try {
    // get Trip instance associated to the provided id
    const trip = await Trip.findByPk(tripId);
    if (!trip) throw {
      status: 404,
      message: 'No trip found with provided id'
    };

    // get Trip's participant associated to the provided id
    const participants = await trip.getParticipants({ where: { email: userId } });
    if (participants.length <= 0) throw {
      status: 404,
      message: 'The requested user is not on this trip'
    };

    // check if participant is admin
    const participant = participants[0].toJSON();
    if (participant.Participant.is_admin) throw {
      status: 404,
      message: 'Cannot remove the trip admin'
    };

    const number = await trip.removeParticipant(participants[0]);
    if (number <= 0) throw {
      status: 500,
      message: 'It was not possible to remove the requested user from the trip'
    };

    // retrieve updated list of participants for response
    const updatedParticipants = await trip.getParticipants();
    if (updatedParticipants.length < 0) throw {
      status: 500,
      message: 'Not possible to retrieve participants list'
    };
    
    // include departure location and car allocation info
    // and parse response
    const newParticipants = [];
    for (let p of updatedParticipants) {
      const departure_location = await p.Participant.getDepartureLocation();
      const car = await p.Participant.getCar();
      p = p.toJSON();
      p.car = {seats: 0};
      if (departure_location) p.departure_location = departure_location.toJSON();
      if (car) p.car = car.toJSON();
      newParticipants.push(p);
    }

    // populate response object
    res.ok = true;
    res.body = parseParticipants(newParticipants);
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
  } finally {
    // send response
    ctx.body = res;
  }
};

module.exports.includeUser = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;
  // store user_email passed as parameter
  const userId = ctx.params.user_email;

  try {
    // get Trip instance associated to the provided id
    const trip = await Trip.findByPk(tripId);
    if (!trip) throw {
      status: 404,
      message: 'No trip found with provided id'
    };

    // get User instance associated to the provided id
    const user = await User.findByPk(userId);
    if (!user) throw {
      status: 404,
      message: 'No user found with provided id'
    };

    // add user to trip as a participant
    await trip.addParticipant(user);

    // retrieve updated list of participants for response
    const participants = await trip.getParticipants();
    if (participants.length < 0) throw {
      status: 500,
      message: 'Not possible to retrieve participants list'
    };
    
    // include departure location and car allocation info
    // and parse response
    const newParticipants = [];
    for (let p of participants) {
      const departure_location = await p.Participant.getDepartureLocation();
      const car = await p.Participant.getCar();
      p = p.toJSON();
      p.car = {seats: 0};
      if (departure_location) p.departure_location = departure_location.toJSON();
      if (car) p.car = car.toJSON();
      newParticipants.push(p);
    }

    // populate response object
    res.ok = true;
    res.body = parseParticipants(newParticipants);
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
  } finally {
    // send response
    ctx.body = res;
  }
};

module.exports.updateInfo = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;
  // store trip object passed in body
  const tripInfo = ctx.request.body;

  try {
    // get Trip instance associated to the provided id
    const oldTrip = await Trip.findByPk(tripId);
    if (!oldTrip) throw {
      status: 404,
      message: 'No trip found with provided id'
    };

    const trip = await oldTrip.update({
      ...tripInfo,
      date: (new Date(+tripInfo.date)).toISOString()
    }, {
      fields: ['title', 'description', 'date', 'picture']
    });

    // check if there is new destination information
    if (tripInfo.destination) {
      const destination = await Location.create(tripInfo.destination);
      if (!destination) throw {
        status: 400,
        message: 'Not possible to create trip: invalid location'
      };
      await trip.setDestination(destination);
    }
    
    // retrieve recently added trip with more information
    let newTrip = await Trip.findByPk(trip.get('id'),
      {include: [
        { model: Location, as: 'destination' }
      ]}
    );
    newTrip = newTrip.toJSON();
    delete newTrip.destination_id;

    // populate response object
    res.ok = true;
    res.body = newTrip;
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
  } finally {
    // send response
    ctx.body = res;
  }
};

module.exports.updateCars = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;
  // store trip object passed in body
  const cars = ctx.request.body;

  // start a transaction
  const t = await db.transaction();

  try {
    // get Trip instance associated to the provided id
    const oldTrip = await Trip.findByPk(tripId);
    if (!oldTrip) throw {
      status: 404,
      message: 'No trip found with provided id'
    };

    if (cars.length <= 0) throw {
      status: 400,
      message: 'No car information provided'
    };

    let carIntances = [];
    for (let car of cars) {
      // create and save Car instances
      const carIntance = await Car.create(car, { transaction: t });
      carIntances.push(carIntance);
      for (let passId of car.passengers) {
        // retrieve Participant instances from ids
        const passInstance = await Participant.findAll(
          { where: { person_id: passId, trip_id: oldTrip.get('id') } }
        );
        if (passInstance.length <= 0) throw {
          status: 404,
          message: 'No user found with provided id'
        };
        // associate Cars to Passengers
        passInstance[0].setCar(carIntance, { transaction: t });
        // update driver        
        if (passId === car.driver_id)
          passInstance[0].update({ is_driver: true }, { transaction: t });
      }
    }
    // set new car allocation
    await oldTrip.setCars(carIntances, { transaction: t });

    // commit the transaction
    await t.commit();
    
    // retrieve updated car allocation with passenger information
    const newTrip = await Trip.findByPk(oldTrip.get('id'), {
      include: [{
        model: Car,
        as: 'cars',
        include: [{
          model: Participant,
          as: 'passengers'
        }]
      }]
    });
    const newCars = newTrip.cars;

    // populate response object
    res.ok = true;
    res.body = newCars;
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
    // rollback the transaction
    await t.rollback();
  } finally {
    // send response
    ctx.body = res;
  }
};

module.exports.updateParticipantInfo = async ctx => {
  // create response object
  let res = {};
  // store trip_id passed as parameter
  const tripId = ctx.params.trip_id;
  // store trip_id passed as parameter
  const userId = ctx.params.user_email;
  // store trip object passed in body
  const {
    departure_time,
    departure_location,
    is_driver,
    seats
  } = ctx.request.body;

  try {
    
    // get Participant instance associated to the provided ids
    const participants = await Participant.findAll(
      { where: { person_id: userId, trip_id: tripId } }
    );
    if (participants.length <= 0) throw {
      status: 404,
      message: 'No user/trip found with provided ids'
    };
    const oldParticipant = participants[0];

    // update participant info
    const participant = await oldParticipant.update({
      departure_time: (new Date(+departure_time)).toISOString(),
      is_driver
    });

    // check if there is new departure_location
    if (departure_location) {
      const { address, latitude, longitude } = departure_location;
      const destination = await Location.create({
        address,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      });
      if (!destination) throw {
        status: 400,
        message: 'Not possible to update participant info: invalid location'
      };
      await participant.setDepartureLocation(destination);
    }

    // check if participant is driver
    if (is_driver && seats > 0) {
      const newCar = await Car.create({ seats, driver_id: participant.person_id });
      if (!newCar) throw {
        status: 400,
        message: 'Not possible to update participant info: invalid car seats information'
      };
      await participant.setCar(newCar);
    }
    
    // format Participant data for response
    const formattedParticipant = participant.toJSON();
    formattedParticipant.departure_location = await participant.getDepartureLocation();
    delete formattedParticipant.departure_location_id;

    // populate response object
    res.ok = true;
    res.body = formattedParticipant;
    // set response status
    ctx.status = 200;
  } catch (error) {
    // populate response object
    res.ok = false;
    res.error = error.message;
    // set response status
    ctx.status = error.status || 400;
  } finally {
    // send response
    ctx.body = res;
  }
};